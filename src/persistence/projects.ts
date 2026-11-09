import type { AnalysisLimits, Repository } from "@/domain/types";
import type { ProjectMeta } from "./schemas";

/** Pure helpers for creating and naming projects. */

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "project";
}

function randomSuffix(): string {
  const bytes = new Uint8Array(4);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Unique project id: readable slug plus a random suffix. */
export function newProjectId(name: string, suffix: () => string = randomSuffix): string {
  return `${slugify(name)}-${suffix()}`;
}

/** Picks an id that is not in `taken`, derived from `base` (used when importing "as a copy"). */
export function uniqueCopyId(base: string, taken: Set<string>): string {
  const root = base.replace(/-copy(-\d+)?$/, "");
  let candidate = `${root}-copy`;
  for (let n = 2; taken.has(candidate); n++) candidate = `${root}-copy-${n}`;
  return candidate;
}

export function copyName(name: string, taken: Set<string>): string {
  const root = name.replace(/ \(copy( \d+)?\)$/, "");
  let candidate = `${root} (copy)`;
  for (let n = 2; taken.has(candidate); n++) candidate = `${root} (copy ${n})`;
  return candidate.slice(0, 120);
}

export function sourceBytes(repo: Repository): number {
  return repo.files.reduce((sum, f) => sum + f.size, 0);
}

export interface NewProjectOptions {
  name?: string;
  origin: ProjectMeta["origin"];
  limits: AnalysisLimits;
  id?: string;
  now?: Date;
}

/** Builds the metadata record for a freshly analyzed repository. */
export function metaFromRepository(repo: Repository, options: NewProjectOptions): ProjectMeta {
  const now = (options.now ?? new Date()).toISOString();
  const name = (options.name ?? repo.name).trim().slice(0, 120) || "Untitled project";
  return {
    id: options.id ?? newProjectId(name),
    name,
    description: repo.description.slice(0, 400),
    origin: options.origin,
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
    fileCount: repo.analysis.analyzedFiles,
    parsedFileCount: repo.analysis.parsedFiles,
    sourceBytes: sourceBytes(repo),
    languages: repo.languages.slice(0, 5).map((l) => l.language),
    settings: { limits: options.limits },
  };
}
