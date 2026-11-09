import { EXPORT_FORMAT, EXPORT_SCHEMA_VERSION } from "./schemas";

export type ImportErrorCode = "not-json" | "wrong-format" | "newer-version" | "unsupported-version" | "invalid" | "integrity" | "too-large" | "duplicate-ids";

/** Raised when an export file cannot be imported. `issues` lists specific problems for display. */
export class ImportError extends Error {
  constructor(
    public readonly code: ImportErrorCode,
    message: string,
    public readonly issues: string[] = [],
  ) {
    super(message);
    this.name = "ImportError";
  }
}

/** A migration upgrades an export document from schema version N to N+1. */
export type Migration = (input: Record<string, unknown>) => Record<string, unknown>;

/**
 * Registry of export-format migrations, keyed by the version they upgrade FROM.
 * Version 1 is the first release, so there is nothing to migrate yet; when the format changes, bump
 * EXPORT_SCHEMA_VERSION and register `1: (doc) => ...` here so old files keep importing.
 */
export const EXPORT_MIGRATIONS: Record<number, Migration> = {};

/**
 * Checks the envelope (format + version) and upgrades older documents to the current version.
 * Newer or unknown versions are rejected rather than half-imported.
 */
export function migrateExport(raw: unknown, migrations: Record<number, Migration> = EXPORT_MIGRATIONS, current = EXPORT_SCHEMA_VERSION): { data: Record<string, unknown>; fromVersion: number } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new ImportError("wrong-format", "This is not a CodebaseXplorer export file.");
  let doc = raw as Record<string, unknown>;
  if (doc.format !== EXPORT_FORMAT) throw new ImportError("wrong-format", "This is not a CodebaseXplorer export file (missing or unknown format marker).");
  const version = doc.schemaVersion;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) throw new ImportError("invalid", "The export file has no valid schema version.");
  if (version > current) {
    throw new ImportError("newer-version", `This file was created by a newer version of CodebaseXplorer (format v${version}; this app understands up to v${current}). Update the app to import it.`);
  }
  const fromVersion = version;
  for (let v = version; v < current; v++) {
    const migrate = migrations[v];
    if (!migrate) throw new ImportError("unsupported-version", `Export format v${v} can no longer be imported (no migration to v${v + 1}).`);
    doc = { ...migrate(doc), schemaVersion: v + 1 };
  }
  return { data: doc, fromVersion };
}
