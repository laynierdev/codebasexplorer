import { RepositorySchema } from "@/domain/schemas";
import type { Repository } from "@/domain/types";
import { AppSettingsSchema, ProjectMetaSchema, StoredDocSchema, type AppSettings, type ProjectMeta, type StoredDoc } from "./schemas";
import { StorageError } from "./errors";

/** Validation of records read from storage. A failure means corruption or an incompatible version. */

function describe(err: unknown): string {
  const issue = (err as { issues?: { path: PropertyKey[]; message: string }[] })?.issues?.[0];
  return issue ? `${issue.path.map(String).join(".") || "record"}: ${issue.message}` : "unreadable";
}

export function readMeta(raw: unknown, id = "?"): ProjectMeta {
  const parsed = ProjectMetaSchema.safeParse(raw);
  if (!parsed.success) throw new StorageError("corrupted", `The saved project "${id}" is damaged (${describe(parsed.error)}).`);
  return parsed.data;
}

export function readRepository(raw: unknown, id = "?"): Repository {
  const wrapped = raw as { repository?: unknown } | undefined;
  const parsed = RepositorySchema.safeParse(wrapped?.repository);
  if (!parsed.success) throw new StorageError("corrupted", `The analysis data of project "${id}" is damaged (${describe(parsed.error)}).`);
  return parsed.data;
}

export function readDoc(raw: unknown): StoredDoc | null {
  const parsed = StoredDocSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function readSettings(raw: unknown): AppSettings | null {
  const parsed = AppSettingsSchema.safeParse((raw as { value?: unknown } | undefined)?.value);
  return parsed.success ? parsed.data : null;
}
