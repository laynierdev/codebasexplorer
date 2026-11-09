import type { DocSection } from "@/ai/schemas";
import { RepositorySchema } from "@/domain/schemas";
import { guardStorage, StorageError, toStorageError } from "./errors";
import { AppSettingsSchema, ProjectMetaSchema, StoredDocSchema, type AppSettings, type ProjectMeta, type StoredDoc } from "./schemas";
import type { ProjectStore, StorageUsage, StoredProject } from "./store";
import { readDoc, readMeta, readRepository, readSettings } from "./validate";

const DB_NAME = "codebasexplorer";
const DB_VERSION = 1;
const PROJECTS = "projects";
const REPOSITORIES = "repositories";
const DOCS = "docs";
const SETTINGS = "settings";

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function complete(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new DOMException("The transaction was aborted.", "AbortError"));
  });
}

function openDatabase(name: string, factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    let opened: IDBOpenDBRequest;
    try {
      opened = factory.open(name, DB_VERSION);
    } catch (err) {
      reject(toStorageError(err));
      return;
    }
    opened.onupgradeneeded = () => {
      const db = opened.result;
      // Version 1 layout. Future versions add `if (event.oldVersion < N)` steps here.
      if (!db.objectStoreNames.contains(PROJECTS)) db.createObjectStore(PROJECTS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(REPOSITORIES)) db.createObjectStore(REPOSITORIES, { keyPath: "projectId" });
      if (!db.objectStoreNames.contains(DOCS)) db.createObjectStore(DOCS, { keyPath: ["projectId", "section"] });
      if (!db.objectStoreNames.contains(SETTINGS)) db.createObjectStore(SETTINGS, { keyPath: "key" });
    };
    opened.onsuccess = () => {
      const db = opened.result;
      // Another tab upgrading or deleting the database (or the user clearing site data): step aside.
      // The store reopens the database on demand the next time it is used.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    opened.onerror = () => reject(toStorageError(opened.error));
    opened.onblocked = () => reject(new StorageError("blocked", "Close other CodebaseXplorer tabs to finish upgrading the saved data."));
  });
}

/**
 * IndexedDB implementation. Layout:
 *  - projects:      one small metadata record per project (listing never loads source code)
 *  - repositories:  the full analysis result of each project, including source files
 *  - docs:          AI-written documentation, keyed by [projectId, section]
 *  - settings:      application settings under the key "app"
 */
export class IndexedDbProjectStore implements ProjectStore {
  private constructor(
    private db: IDBDatabase,
    private readonly name: string,
    private readonly factory: IDBFactory,
  ) {}

  /** `factory` defaults to the browser's IndexedDB; pass `null` to simulate an unavailable one. */
  static async open(name = DB_NAME, factoryArg?: IDBFactory | null): Promise<IndexedDbProjectStore> {
    const factory = factoryArg === undefined ? (typeof indexedDB === "undefined" ? null : indexedDB) : factoryArg;
    if (!factory) throw new StorageError("unavailable", "Browser storage (IndexedDB) is not available in this browser.");
    return new IndexedDbProjectStore(await openDatabase(name, factory), name, factory);
  }

  /**
   * Runs an operation against the database. If the connection was closed underneath us (site data cleared,
   * another tab upgraded the database), the database is reopened once and the operation is retried.
   */
  private run<T>(operation: (db: IDBDatabase) => Promise<T>): Promise<T> {
    return guardStorage(async () => {
      try {
        return await operation(this.db);
      } catch (err) {
        if ((err as { name?: string })?.name !== "InvalidStateError") throw err;
        this.db = await openDatabase(this.name, this.factory);
        return await operation(this.db);
      }
    });
  }

  list(): Promise<{ projects: ProjectMeta[]; damaged: string[] }> {
    return this.run(async (db) => {
      const raws = await request(db.transaction(PROJECTS, "readonly").objectStore(PROJECTS).getAll());
      const projects: ProjectMeta[] = [];
      const damaged: string[] = [];
      for (const raw of raws as { id?: string }[]) {
        try {
          projects.push(readMeta(raw, raw?.id));
        } catch {
          damaged.push(String(raw?.id ?? "unknown"));
        }
      }
      projects.sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt));
      return { projects, damaged };
    });
  }

  get(id: string): Promise<StoredProject | null> {
    return this.run(async (db) => {
      const tx = db.transaction([PROJECTS, REPOSITORIES], "readonly");
      const [metaRaw, repoRaw] = await Promise.all([request(tx.objectStore(PROJECTS).get(id)), request(tx.objectStore(REPOSITORIES).get(id))]);
      if (metaRaw === undefined) return null;
      const meta = readMeta(metaRaw, id);
      if (repoRaw === undefined) throw new StorageError("corrupted", `The analysis data of project "${id}" is missing.`);
      return { meta, repository: readRepository(repoRaw, id) };
    });
  }

  has(id: string): Promise<boolean> {
    return this.run(async (db) => (await request(db.transaction(PROJECTS, "readonly").objectStore(PROJECTS).count(id))) > 0);
  }

  save(project: StoredProject): Promise<void> {
    return this.run(async (db) => {
      // Validate before writing so only well-formed data is ever stored.
      const meta = ProjectMetaSchema.parse(project.meta);
      const repository = RepositorySchema.parse(project.repository);
      const tx = db.transaction([PROJECTS, REPOSITORIES], "readwrite");
      tx.objectStore(PROJECTS).put(meta);
      tx.objectStore(REPOSITORIES).put({ projectId: meta.id, repository });
      await complete(tx);
    });
  }

  updateMeta(id: string, patch: Partial<Pick<ProjectMeta, "name" | "description" | "lastOpenedAt" | "updatedAt">>): Promise<ProjectMeta> {
    return this.run(async (db) => {
      const tx = db.transaction(PROJECTS, "readwrite");
      const store = tx.objectStore(PROJECTS);
      const raw = await request(store.get(id));
      if (raw === undefined) {
        tx.abort();
        throw new StorageError("not-found", `Project "${id}" was not found.`);
      }
      const next = ProjectMetaSchema.parse({ ...readMeta(raw, id), ...patch });
      store.put(next);
      await complete(tx);
      return next;
    });
  }

  delete(id: string): Promise<void> {
    return this.run(async (db) => {
      const tx = db.transaction([PROJECTS, REPOSITORIES, DOCS], "readwrite");
      tx.objectStore(PROJECTS).delete(id);
      tx.objectStore(REPOSITORIES).delete(id);
      tx.objectStore(DOCS).delete(IDBKeyRange.bound([id, ""], [id, "￿"]));
      await complete(tx);
    });
  }

  listDocs(projectId: string): Promise<StoredDoc[]> {
    return this.run(async (db) => {
      const store = db.transaction(DOCS, "readonly").objectStore(DOCS);
      const raws = await request(store.getAll(IDBKeyRange.bound([projectId, ""], [projectId, "￿"])));
      return (raws as { doc?: unknown }[]).map((r) => readDoc(r.doc)).filter((d): d is StoredDoc => d !== null);
    });
  }

  saveDoc(projectId: string, doc: StoredDoc): Promise<void> {
    return this.run(async (db) => {
      const valid = StoredDocSchema.parse(doc);
      const tx = db.transaction([PROJECTS, DOCS], "readwrite");
      if ((await request(tx.objectStore(PROJECTS).count(projectId))) === 0) {
        tx.abort();
        throw new StorageError("not-found", `Project "${projectId}" was not found.`);
      }
      tx.objectStore(DOCS).put({ projectId, section: valid.section, doc: valid });
      await complete(tx);
    });
  }

  deleteDoc(projectId: string, section: DocSection): Promise<void> {
    return this.run(async (db) => {
      const tx = db.transaction(DOCS, "readwrite");
      tx.objectStore(DOCS).delete([projectId, section]);
      await complete(tx);
    });
  }

  getSettings(): Promise<AppSettings | null> {
    return this.run(async (db) => readSettings(await request(db.transaction(SETTINGS, "readonly").objectStore(SETTINGS).get("app"))));
  }

  saveSettings(settings: AppSettings): Promise<void> {
    return this.run(async (db) => {
      const value = AppSettingsSchema.parse(settings);
      const tx = db.transaction(SETTINGS, "readwrite");
      tx.objectStore(SETTINGS).put({ key: "app", value });
      await complete(tx);
    });
  }

  async usage(): Promise<StorageUsage> {
    try {
      const estimate = await navigator.storage?.estimate?.();
      return { usageBytes: estimate?.usage, quotaBytes: estimate?.quota };
    } catch {
      return {};
    }
  }

  clearAll(): Promise<void> {
    return this.run(async (db) => {
      const tx = db.transaction([PROJECTS, REPOSITORIES, DOCS, SETTINGS], "readwrite");
      for (const name of [PROJECTS, REPOSITORIES, DOCS, SETTINGS]) tx.objectStore(name).clear();
      await complete(tx);
    });
  }

  close(): void {
    this.db.close();
  }
}
