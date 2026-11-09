export type StorageErrorCode =
  /** IndexedDB is not available (private mode, blocked by policy, old browser). */
  | "unavailable"
  /** The browser's storage quota is full. */
  | "quota"
  /** A stored record failed validation (corrupted or written by an incompatible version). */
  | "corrupted"
  | "not-found"
  /** Another tab is holding an older version of the database open. */
  | "blocked"
  | "unknown";

/** Failure of a storage operation, with a message that is safe to show to the user. */
export class StorageError extends Error {
  constructor(
    public readonly code: StorageErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "StorageError";
  }
}

/** Maps a low-level IndexedDB/DOM error to a StorageError. */
export function toStorageError(err: unknown, fallbackMessage = "The browser storage operation failed."): StorageError {
  if (err instanceof StorageError) return err;
  const name = (err as { name?: string })?.name;
  if (name === "QuotaExceededError") return new StorageError("quota", "The browser storage is full. Delete saved projects or free up disk space and try again.", { cause: err });
  if (name === "SecurityError" || name === "InvalidStateError") return new StorageError("unavailable", "Browser storage is not available (private browsing or blocked by settings).", { cause: err });
  if (name === "ZodError") return new StorageError("corrupted", "The data to store is invalid and was not saved.", { cause: err });
  if (name === "DataCloneError") return new StorageError("unknown", "The project contains data that the browser cannot store.", { cause: err });
  return new StorageError("unknown", fallbackMessage, { cause: err });
}

/** Runs a storage operation and maps low-level errors (quota, validation, unavailable...) to StorageError. */
export async function guardStorage<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw toStorageError(err);
  }
}
