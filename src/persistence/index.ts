import { IndexedDbProjectStore } from "./indexeddb";
import { MemoryProjectStore } from "./memory";
import type { ProjectStore } from "./store";

export interface OpenedStore {
  store: ProjectStore;
  /** False when browser storage is unavailable and projects will not survive a reload. */
  persistent: boolean;
  /** Why storage is not persistent (shown to the user). */
  reason?: string;
}

/** Opens the best available store: IndexedDB, or an in-memory one (clearly reported) if the browser refuses. */
export async function openStore(): Promise<OpenedStore> {
  try {
    return { store: await IndexedDbProjectStore.open(), persistent: true };
  } catch (err) {
    return { store: new MemoryProjectStore(), persistent: false, reason: err instanceof Error ? err.message : "Browser storage is not available." };
  }
}

export { IndexedDbProjectStore, MemoryProjectStore };
export type { ProjectStore };
