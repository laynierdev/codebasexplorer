import type { Repository } from "@/domain/types";
import type { DocSection } from "@/ai/schemas";
import type { AppSettings, ProjectMeta, StoredDoc } from "./schemas";

export interface StoredProject {
  meta: ProjectMeta;
  repository: Repository;
}

export interface StorageUsage {
  usageBytes?: number;
  quotaBytes?: number;
}

/**
 * Persistence abstraction. The UI only talks to this interface, so the backing technology
 * (IndexedDB today, something else later) can change without touching components.
 * All methods validate what they read and throw StorageError with a user-presentable message.
 */
export interface ProjectStore {
  /**
   * Lightweight metadata of every readable project, most recently opened first.
   * Records that fail validation are not hidden silently: their ids are returned in `damaged`.
   */
  list(): Promise<{ projects: ProjectMeta[]; damaged: string[] }>;
  /** Full project (metadata + analysis result including source). Null when the id is unknown. */
  get(id: string): Promise<StoredProject | null>;
  has(id: string): Promise<boolean>;
  /** Writes metadata and repository atomically (both or neither). */
  save(project: StoredProject): Promise<void>;
  updateMeta(id: string, patch: Partial<Pick<ProjectMeta, "name" | "description" | "lastOpenedAt" | "updatedAt">>): Promise<ProjectMeta>;
  /** Removes the project and everything stored for it (documentation included). */
  delete(id: string): Promise<void>;

  listDocs(projectId: string): Promise<StoredDoc[]>;
  saveDoc(projectId: string, doc: StoredDoc): Promise<void>;
  deleteDoc(projectId: string, section: DocSection): Promise<void>;

  getSettings(): Promise<AppSettings | null>;
  saveSettings(settings: AppSettings): Promise<void>;

  usage(): Promise<StorageUsage>;
  /** Deletes every project, document and setting. */
  clearAll(): Promise<void>;
  close(): void;
}
