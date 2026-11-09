import type { DocSection } from "@/ai/schemas";
import { RepositorySchema } from "@/domain/schemas";
import { guardStorage, StorageError } from "./errors";
import { AppSettingsSchema, ProjectMetaSchema, StoredDocSchema, type AppSettings, type ProjectMeta, type StoredDoc } from "./schemas";
import type { ProjectStore, StorageUsage, StoredProject } from "./store";

/**
 * In-memory store with the same behavior as the IndexedDB one (values are validated and copied in and out).
 * Used when browser storage is unavailable (the app keeps working, nothing survives a reload) and in tests.
 */
export class MemoryProjectStore implements ProjectStore {
  private metas = new Map<string, ProjectMeta>();
  private repos = new Map<string, StoredProject["repository"]>();
  private docs = new Map<string, StoredDoc>();
  private settings: AppSettings | null = null;

  async list(): Promise<{ projects: ProjectMeta[]; damaged: string[] }> {
    const projects = [...this.metas.values()].map((m) => structuredClone(m)).sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt));
    return { projects, damaged: [] };
  }

  async get(id: string): Promise<StoredProject | null> {
    const meta = this.metas.get(id);
    if (!meta) return null;
    const repository = this.repos.get(id);
    if (!repository) throw new StorageError("corrupted", `The analysis data of project "${id}" is missing.`);
    return { meta: structuredClone(meta), repository: structuredClone(repository) };
  }

  async has(id: string): Promise<boolean> {
    return this.metas.has(id);
  }

  save(project: StoredProject): Promise<void> {
    return guardStorage(async () => {
      const meta = ProjectMetaSchema.parse(project.meta);
      const repository = RepositorySchema.parse(project.repository);
      this.metas.set(meta.id, structuredClone(meta));
      this.repos.set(meta.id, structuredClone(repository));
    });
  }

  updateMeta(id: string, patch: Partial<Pick<ProjectMeta, "name" | "description" | "lastOpenedAt" | "updatedAt">>): Promise<ProjectMeta> {
    return guardStorage(async () => {
      const current = this.metas.get(id);
      if (!current) throw new StorageError("not-found", `Project "${id}" was not found.`);
      const next = ProjectMetaSchema.parse({ ...current, ...patch });
      this.metas.set(id, structuredClone(next));
      return structuredClone(next);
    });
  }

  async delete(id: string): Promise<void> {
    this.metas.delete(id);
    this.repos.delete(id);
    for (const key of [...this.docs.keys()]) if (key.startsWith(id + "\u0000")) this.docs.delete(key);
  }

  async listDocs(projectId: string): Promise<StoredDoc[]> {
    return [...this.docs.entries()].filter(([key]) => key.startsWith(projectId + "\u0000")).map(([, doc]) => structuredClone(doc));
  }

  saveDoc(projectId: string, doc: StoredDoc): Promise<void> {
    return guardStorage(async () => {
      if (!this.metas.has(projectId)) throw new StorageError("not-found", `Project "${projectId}" was not found.`);
      const valid = StoredDocSchema.parse(doc);
      this.docs.set(`${projectId}\u0000${valid.section}`, structuredClone(valid));
    });
  }

  async deleteDoc(projectId: string, section: DocSection): Promise<void> {
    this.docs.delete(`${projectId}\u0000${section}`);
  }

  async getSettings(): Promise<AppSettings | null> {
    return this.settings ? structuredClone(this.settings) : null;
  }

  saveSettings(settings: AppSettings): Promise<void> {
    return guardStorage(async () => {
      this.settings = structuredClone(AppSettingsSchema.parse(settings));
    });
  }

  async usage(): Promise<StorageUsage> {
    return {};
  }

  async clearAll(): Promise<void> {
    this.metas.clear();
    this.repos.clear();
    this.docs.clear();
    this.settings = null;
  }

  close(): void {}
}
