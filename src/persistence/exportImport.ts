import type { Repository } from "@/domain/types";
import { StorageError } from "./errors";
import { checkRepositoryIntegrity } from "./integrity";
import { ImportError, migrateExport } from "./migrate";
import { copyName, slugify, sourceBytes, uniqueCopyId } from "./projects";
import { APP_NAME, APP_VERSION, EXPORT_FORMAT, EXPORT_SCHEMA_VERSION, ExportFileSchema, type ExportFile, type ExportProject, type ProjectMeta, type StoredDoc } from "./schemas";
import type { ProjectStore } from "./store";

/** Largest export file (in characters) that will be parsed in the browser. */
export const MAX_IMPORT_CHARS = 150 * 1024 * 1024;

export interface ExportInput {
  meta: ProjectMeta;
  repository: Repository;
  docs: StoredDoc[];
}

/** Builds an export document, validating it so an invalid file is never written. */
export function buildExport(projects: ExportInput[], now = new Date()): ExportFile {
  return ExportFileSchema.parse({
    format: EXPORT_FORMAT,
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    app: { name: APP_NAME, version: APP_VERSION },
    projects: projects.map((p) => ({ meta: p.meta, repository: p.repository, docs: p.docs })),
  });
}

export function serializeExport(file: ExportFile): string {
  return JSON.stringify(file);
}

export function exportFileName(projects: ProjectMeta[], now = new Date()): string {
  const day = now.toISOString().slice(0, 10);
  return `codebasexplorer-${projects.length === 1 ? slugify(projects[0]?.name ?? "project") : "projects"}-${day}.json`;
}

/**
 * Property paths present in the input but removed by schema parsing (unknown fields).
 * Reported to the user so nothing is dropped silently. Array indices are collapsed to [].
 */
export function findStrippedKeys(input: unknown, output: unknown, path = "", found = new Set<string>()): string[] {
  if (found.size >= 25) return [...found];
  if (Array.isArray(input)) {
    const out = Array.isArray(output) ? output : [];
    input.forEach((item, i) => findStrippedKeys(item, out[i], `${path}[]`, found));
  } else if (input && typeof input === "object") {
    const out = (output && typeof output === "object" ? output : {}) as Record<string, unknown>;
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (!(key in out)) found.add(path ? `${path}.${key}` : key);
      else findStrippedKeys(value, out[key], path ? `${path}.${key}` : key, found);
    }
  }
  return [...found];
}

export interface ImportCandidate {
  project: ExportProject;
  /** Metadata of the saved project with the same id, if any (a conflict the user must resolve). */
  existing?: ProjectMeta;
}

export interface ParsedImport {
  fromVersion: number;
  exportedAt: string;
  app: { name: string; version: string };
  candidates: ImportCandidate[];
  /** Fields present in the file that this version does not know; they are NOT imported. */
  ignoredFields: string[];
  warnings: string[];
}

/** Recomputes the derived statistics of a project from its repository so a file cannot misreport them. */
function normalizeMeta(meta: ProjectMeta, repo: Repository): ProjectMeta {
  return { ...meta, fileCount: repo.analysis.analyzedFiles, parsedFileCount: repo.analysis.parsedFiles, sourceBytes: sourceBytes(repo), languages: repo.languages.slice(0, 5).map((l) => l.language) };
}

/** Parses and fully validates an export file. Throws ImportError with specific, displayable issues. */
export function parseImport(text: string, existing: ProjectMeta[]): ParsedImport {
  if (text.length > MAX_IMPORT_CHARS) throw new ImportError("too-large", "The file is too large to import in the browser.");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ImportError("not-json", "The file is not valid JSON (it may be truncated or not an export file).");
  }

  const { data, fromVersion } = migrateExport(raw);
  const parsed = ExportFileSchema.safeParse(data);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 8).map((i) => `${i.path.map(String).join(".") || "file"}: ${i.message}`);
    throw new ImportError("invalid", "The file is damaged or does not match the export format.", issues);
  }

  const seen = new Set<string>();
  for (const p of parsed.data.projects) {
    if (seen.has(p.meta.id)) throw new ImportError("duplicate-ids", `The file contains the project id "${p.meta.id}" more than once.`);
    seen.add(p.meta.id);
  }
  for (const p of parsed.data.projects) {
    const issues = checkRepositoryIntegrity(p.repository);
    if (issues.length) throw new ImportError("integrity", `The project "${p.meta.name}" has inconsistent data.`, issues);
  }

  const warnings: string[] = [];
  if (fromVersion < EXPORT_SCHEMA_VERSION) warnings.push(`The file used export format v${fromVersion} and was upgraded to v${EXPORT_SCHEMA_VERSION}.`);
  const ignoredFields = findStrippedKeys(data, parsed.data);
  if (ignoredFields.length) warnings.push(`The file contains fields this version does not recognize; they will not be imported: ${ignoredFields.slice(0, 6).join(", ")}${ignoredFields.length > 6 ? ", ..." : ""}.`);

  const byId = new Map(existing.map((e) => [e.id, e]));
  return {
    fromVersion,
    exportedAt: parsed.data.exportedAt,
    app: parsed.data.app,
    ignoredFields,
    warnings,
    candidates: parsed.data.projects.map((p) => ({ project: { ...p, meta: normalizeMeta(p.meta, p.repository) }, existing: byId.get(p.meta.id) })),
  };
}

/** What to do with a project whose id already exists. */
export type Resolution = "replace" | "copy" | "skip";

export interface ImportOutcome {
  id: string;
  name: string;
  result: "added" | "replaced" | "copied" | "skipped" | "failed";
  /** Id of the saved project when it differs from `id` (copies). */
  newId?: string;
  message?: string;
}

export interface ImportReport {
  outcomes: ImportOutcome[];
  warnings: string[];
}

/**
 * Imports the candidates into the store. Conflicting projects follow the user's resolution; a conflict
 * without an explicit resolution is skipped, never overwritten. A replacement writes the new data first
 * (atomically) and only then reconciles documentation, so a failure never loses the existing project.
 */
export async function applyImport(store: ProjectStore, parsed: ParsedImport, resolutions: Record<string, Resolution>, now = new Date()): Promise<ImportReport> {
  const outcomes: ImportOutcome[] = [];
  const { projects } = await store.list();
  const takenIds = new Set([...projects.map((p) => p.id), ...parsed.candidates.map((c) => c.project.meta.id)]);
  const takenNames = new Set(projects.map((p) => p.name));
  let storageFull = false;

  for (const { project, existing } of parsed.candidates) {
    const { meta, repository, docs } = project;
    const base = { id: meta.id, name: meta.name };
    if (storageFull) {
      outcomes.push({ ...base, result: "failed", message: "Not imported: the browser storage is full." });
      continue;
    }
    const choice: Resolution = existing ? (resolutions[meta.id] ?? "skip") : (resolutions[meta.id] === "skip" ? "skip" : "replace");
    if (choice === "skip") {
      outcomes.push({ ...base, result: "skipped", message: existing ? "Kept the existing project." : "Skipped by choice." });
      continue;
    }

    try {
      if (!existing) {
        await store.save({ meta, repository });
        for (const doc of docs) await store.saveDoc(meta.id, doc);
        outcomes.push({ ...base, result: "added" });
      } else if (choice === "replace") {
        await store.save({ meta: { ...meta, updatedAt: now.toISOString() }, repository });
        const keep = new Set(docs.map((d) => d.section));
        for (const old of await store.listDocs(meta.id)) if (!keep.has(old.section)) await store.deleteDoc(meta.id, old.section);
        for (const doc of docs) await store.saveDoc(meta.id, doc);
        outcomes.push({ ...base, result: "replaced" });
      } else {
        const newId = uniqueCopyId(meta.id, takenIds);
        const name = copyName(meta.name, takenNames);
        takenIds.add(newId);
        takenNames.add(name);
        await store.save({ meta: { ...meta, id: newId, name, updatedAt: now.toISOString() }, repository });
        for (const doc of docs) await store.saveDoc(newId, doc);
        outcomes.push({ ...base, result: "copied", newId, message: `Saved as "${name}".` });
      }
    } catch (err) {
      const e = err instanceof StorageError ? err : new StorageError("unknown", "The project could not be saved.");
      if (e.code === "quota") storageFull = true;
      outcomes.push({ ...base, result: "failed", message: e.message });
    }
  }
  return { outcomes, warnings: parsed.warnings };
}
