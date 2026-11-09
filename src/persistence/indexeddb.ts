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

const guard = guardStorage;

/**
 * IndexedDB implementation. Layout:
 *  - projects:      one small metadata record per project (listing never loads source code)
 *  - repositories:  the full analysis result of each project, including source files
 *  - docs:          AI-written documentation, keyed by [projectId, section]
 *  - settings:      application settings under the key "app"
 */
export class IndexedDbProjectStore implements ProjectStore {
  private constructor(private readonly db: IDBDatabase) {
    // Another tab upgrading the database: step aside instead of blocking it.
    db.onversionchange = () => db.close();
  }

  /** `factory` defaults to the browser's IndexedDB; pass `null` to simulate an unavailable one. */
  static async open(name = DB_NAME, factoryArg?: IDBFactory | null): Promise<IndexedDbProjectStore> {
    const factory = factoryArg === undefined ? (typeof indexedDB === "undefined" ? null : indexedDB) : factoryArg;
    if (!factory) throw new StorageError("unavailable", "Browser storage (IndexedDB) is not available in this browser.");
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
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
      opened.onsuccess = () => resolve(opened.result);
      opened.onerror = () => reject(toStorageError(opened.error));
      opened.onblocked = () => reject(new StorageError("blocked", "Close other CodebaseXplorer tabs to finish upgrading the saved data."));
    });
    return new IndexedDbProjectStore(db);
  }

  list(): Promise<{ projects: ProjectMeta[]; damaged: string[] }> {
    return guard(async () => {
      const tx = this.db.transaction(PROJECTS, "readonly");
      const raws = await request(tx.objectStore(PROJECTS).getAll());
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
    return guard(async () => {
      const tx = this.db.transaction([PROJECTS, REPOSITORIES], "readonly");
      const [metaRaw, repoRaw] = await Promise.all([request(tx.objectStore(PROJECTS).get(id)), request(tx.objectStore(REPOSITORIES).get(id))]);
      if (metaRaw === undefined) return null;
      const meta = readMeta(metaRaw, id);
      if (repoRaw === undefined) throw new StorageError("corrupted", `The analysis data of project "${id}" is missing.`);
      return { meta, repository: readRepository(repoRaw, id) };
    });
  }

  has(id: string): Promise<boolean> {
    return guard(async () => (await request(this.db.transaction(PROJECTS, "readonly").objectStore(PROJECTS).count(id))) > 0);
  }

  save(project: StoredProject): Promise<void> {
    return guard(async () => {
      // Validate before writing so only well-formed data is ever stored.
      const meta = ProjectMetaSchema.parse(project.meta);
      const repository = RepositorySchema.parse(project.repository);
      const tx = this.db.transaction([PROJECTS, REPOSITORIES], "readwrite");
      tx.objectStore(PROJECTS).put(meta);
      tx.objectStore(REPOSITORIES).put({ projectId: meta.id, repository });
      await complete(tx);
    });
  }

  updateMeta(id: string, patch: Partial<Pick<ProjectMeta, "name" | "description" | "lastOpenedAt" | "updatedAt">>): Promise<ProjectMeta> {
    return guard(async () => {
      const tx = this.db.transaction(PROJECTS, "readwrite");
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
    return guard(async () => {
      const tx = this.db.transaction([PROJECTS, REPOSITORIES, DOCS], "readwrite");
      tx.objectStore(PROJECTS).delete(id);
      tx.objectStore(REPOSITORIES).delete(id);
      tx.objectStore(DOCS).delete(IDBKeyRange.bound([id, ""], [id, "￿"]));
      await complete(tx);
    });
  }

  listDocs(projectId: string): Promise<StoredDoc[]> {
    return guard(async () => {
      const store = this.db.transaction(DOCS, "readonly").objectStore(DOCS);
      const raws = await request(store.getAll(IDBKeyRange.bound([projectId, ""], [projectId, "￿"])));
      return (raws as { doc?: unknown }[]).map((r) => readDoc(r.doc)).filter((d): d is StoredDoc => d !== null);
    });
  }

  saveDoc(projectId: string, doc: StoredDoc): Promise<void> {
    return guard(async () => {
      const valid = StoredDocSchema.parse(doc);
      const tx = this.db.transaction([PROJECTS, DOCS], "readwrite");
      if ((await request(tx.objectStore(PROJECTS).count(projectId))) === 0) {
        tx.abort();
        throw new StorageError("not-found", `Project "${projectId}" was not found.`);
      }
      tx.objectStore(DOCS).put({ projectId, section: valid.section, doc: valid });
      await complete(tx);
    });
  }

  deleteDoc(projectId: string, section: DocSection): Promise<void> {
    return guard(async () => {
      const tx = this.db.transaction(DOCS, "readwrite");
      tx.objectStore(DOCS).delete([projectId, section]);
      await complete(tx);
    });
  }

  getSettings(): Promise<AppSettings | null> {
    return guard(async () => readSettings(await request(this.db.transaction(SETTINGS, "readonly").objectStore(SETTINGS).get("app"))));
  }

  saveSettings(settings: AppSettings): Promise<void> {
    return guard(async () => {
      const value = AppSettingsSchema.parse(settings);
      const tx = this.db.transaction(SETTINGS, "readwrite");
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
    return guard(async () => {
      const tx = this.db.transaction([PROJECTS, REPOSITORIES, DOCS, SETTINGS], "readwrite");
      for (const name of [PROJECTS, REPOSITORIES, DOCS, SETTINGS]) tx.objectStore(name).clear();
      await complete(tx);
    });
  }

  close(): void {
    this.db.close();
  }
}
