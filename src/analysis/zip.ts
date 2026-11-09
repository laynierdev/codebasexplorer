import { unzipSync } from "fflate";
import type { AnalysisLimits, SkippedItem } from "@/domain/types";
import { IgnoreRules, ScanPlanner, formatBytes } from "./ignore";
import { ArchiveError } from "./limits";

/** A file extracted from an archive or folder. Content is raw bytes; nothing is ever executed. */
export interface RawEntry {
  path: string;
  data: Uint8Array;
}

export interface ExtractionResult {
  entries: RawEntry[];
  skipped: SkippedItem[];
  /** Total number of entries seen in the archive (files, directories, ignored ones). */
  totalEntries: number;
}

const WINDOWS_DRIVE = /^[a-zA-Z]:/;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/**
 * Normalizes an archive entry name to a safe relative POSIX path.
 * Throws for absolute paths, drive letters, `..` segments and control characters.
 * Returns null for directory entries.
 */
export function sanitizeEntryPath(name: string, limits: Pick<AnalysisLimits, "maxPathLength" | "maxPathDepth">): string | null {
  if (CONTROL_CHARS.test(name)) throw new ArchiveError("unsafe-path", `Entry name contains control characters: ${JSON.stringify(name.slice(0, 60))}`);
  const normalized = name.replace(/\\/g, "/");
  if (normalized.startsWith("/") || WINDOWS_DRIVE.test(normalized)) {
    throw new ArchiveError("unsafe-path", `Absolute path in archive: ${name}`);
  }
  const isDir = normalized.endsWith("/");
  const parts = normalized.split("/").filter((p) => p !== "" && p !== ".");
  if (parts.some((p) => p === "..")) {
    throw new ArchiveError("unsafe-path", `Path traversal in archive entry: ${name}`);
  }
  if (isDir || parts.length === 0) return null;
  if (normalized.length > limits.maxPathLength) throw new ArchiveError("path-too-long", `Entry path exceeds ${limits.maxPathLength} characters.`);
  if (parts.length > limits.maxPathDepth) throw new ArchiveError("path-too-deep", `Entry path is deeper than ${limits.maxPathDepth} levels: ${name}`);
  return parts.join("/");
}

interface EntryInfo {
  name: string;
  path: string;
  size: number;
  originalSize: number;
}

const decoder = new TextDecoder("utf-8");

/**
 * Safely extracts a ZIP archive into memory.
 *
 * Safety measures, all applied BEFORE an entry is decompressed:
 *  - archive size and entry count are capped;
 *  - path traversal, absolute paths, control characters and duplicates reject the WHOLE archive;
 *  - ignored directories (node_modules, .git, ...), binaries and oversized files are never inflated;
 *  - the total size of what will be inflated and the per-entry compression ratio are capped (zip-bomb guard).
 * After decompression the real length is compared with the declared one, so a header that lies
 * about the size is detected. Nothing is written to disk and nothing is executed.
 */
export function extractZip(bytes: Uint8Array, limits: AnalysisLimits): ExtractionResult {
  if (bytes.byteLength === 0) throw new ArchiveError("empty", "The archive is empty.");
  if (bytes.byteLength > limits.maxArchiveBytes) {
    throw new ArchiveError("archive-too-large", `Archive is ${formatBytes(bytes.byteLength)}; the limit is ${formatBytes(limits.maxArchiveBytes)}.`);
  }
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) throw new ArchiveError("not-a-zip", "The file is not a valid ZIP archive.");

  // Pass 1: validate every entry name/size and inflate only .gitignore files (tiny) to learn the ignore rules.
  const infos: EntryInfo[] = [];
  const seen = new Set<string>();
  let entryCount = 0;
  const gitignoreTexts = new Map<string, string>();

  const rawGitignores = guarded(() =>
    unzipSync(bytes, {
      filter(info) {
        entryCount++;
        if (entryCount > limits.maxEntries) throw new ArchiveError("too-many-entries", `Archive has more than ${limits.maxEntries} entries.`);
        const path = sanitizeEntryPath(info.name, limits);
        if (path === null) return false;
        const key = path.toLowerCase();
        if (seen.has(key)) throw new ArchiveError("duplicate-path", `Duplicate entry in archive: ${path}`);
        seen.add(key);
        infos.push({ name: info.name, path, size: info.size, originalSize: info.originalSize });
        return path.endsWith("/.gitignore") || path === ".gitignore" ? info.originalSize <= 256 * 1024 : false;
      },
    }),
  );

  const root = commonRoot(infos.map((i) => i.path));
  const strip = (p: string) => (root ? p.slice(root.length + 1) : p);
  for (const [name, data] of Object.entries(rawGitignores)) {
    const info = infos.find((i) => i.name === name || i.path === name);
    if (!info) continue;
    const rel = strip(info.path);
    const dir = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
    gitignoreTexts.set(dir, decoder.decode(data));
  }

  // Decide what to inflate.
  const planner = new ScanPlanner(limits, new IgnoreRules(limits, gitignoreTexts));
  const included = new Map<string, EntryInfo>();
  let totalIncluded = 0;
  for (const info of infos) {
    const rel = strip(info.path);
    if (!planner.decide(rel, info.originalSize).include) continue;
    totalIncluded += info.originalSize;
    if (totalIncluded > limits.maxTotalBytes) {
      throw new ArchiveError("uncompressed-too-large", `Analyzable content expands beyond ${formatBytes(limits.maxTotalBytes)}.`);
    }
    if (info.size > 0 && info.originalSize > 1024 * 1024 && info.originalSize / info.size > limits.maxCompressionRatio) {
      throw new ArchiveError("compression-ratio", `Suspicious compression ratio on ${rel}.`);
    }
    included.set(info.path, info);
  }

  // Pass 2: inflate only the included entries.
  const files = guarded(() =>
    unzipSync(bytes, {
      filter(info) {
        const path = sanitizeEntryPath(info.name, limits);
        return path !== null && included.has(path);
      },
    }),
  );

  const entries: RawEntry[] = [];
  for (const [name, data] of Object.entries(files)) {
    const path = sanitizeEntryPath(name, limits);
    if (path === null) continue;
    const info = included.get(path);
    if (info && data.byteLength !== info.originalSize) {
      throw new ArchiveError("size-mismatch", `Entry ${path} does not match its declared size (possible tampered archive).`);
    }
    entries.push({ path: strip(path), data });
  }

  return { entries, skipped: planner.skipped(), totalEntries: entryCount };
}

function guarded<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof ArchiveError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    if (/encrypt|password/i.test(message)) throw new ArchiveError("encrypted", "Encrypted archives are not supported.");
    throw new ArchiveError("not-a-zip", `The archive could not be read: ${message}`);
  }
}

/** GitHub-style archives wrap everything in one top-level folder; returns its name so paths can be shortened. */
export function commonRoot(paths: string[]): string | null {
  if (paths.length === 0) return null;
  const first = paths[0]?.split("/")[0];
  if (!first) return null;
  return paths.every((p) => p.includes("/") && p.split("/")[0] === first) ? first : null;
}
