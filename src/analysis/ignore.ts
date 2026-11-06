import ignore, { type Ignore } from "ignore";
import type { AnalysisLimits, SkippedItem, SkipReason } from "@/domain/types";

/** Directories that are noise for code understanding. Matched by name at any depth. */
export const IGNORED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  ".vercel",
  ".cache",
  ".parcel-cache",
  ".gradle",
  ".idea",
  ".vscode",
  "dist",
  "build",
  "out",
  "coverage",
  ".nyc_output",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".venv",
  "venv",
  "bower_components",
]);

/** Generated or irrelevant files, matched with gitignore syntax. */
export const IGNORED_PATTERNS = [
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  "bun.lock",
  "composer.lock",
  "Gemfile.lock",
  "poetry.lock",
  "Cargo.lock",
  "*.min.js",
  "*.min.css",
  "*.map",
  "*.tsbuildinfo",
  "*.log",
  ".DS_Store",
  "Thumbs.db",
];

export const BINARY_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "avif", "ico", "bmp", "tiff", "psd",
  "pdf", "zip", "gz", "tgz", "tar", "7z", "rar", "bz2", "xz",
  "woff", "woff2", "ttf", "otf", "eot",
  "mp3", "mp4", "mov", "avi", "mkv", "wav", "ogg", "webm",
  "exe", "dll", "so", "dylib", "bin", "o", "a", "class", "jar", "war", "pyc", "wasm",
  "xlsx", "xls", "docx", "doc", "pptx", "ppt", "sqlite", "db", "lock-binary",
]);

export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const idx = name.lastIndexOf(".");
  return idx > 0 ? name.slice(idx + 1).toLowerCase() : "";
}

export interface IgnoreMatch {
  reason: Extract<SkipReason, "ignored-directory" | "ignored-pattern" | "gitignore">;
  detail: string;
  /** Path that identifies the skipped group: a directory (with trailing slash) or a single file. */
  groupPath: string;
  isDirectory: boolean;
}

/** Decides whether a path is ignored: built-in directory list, built-in patterns, extra patterns and .gitignore files. */
export class IgnoreRules {
  private readonly patterns: Ignore;
  private readonly extra: Ignore;
  private readonly gitignores: { dir: string; ig: Ignore }[] = [];

  constructor(
    limits: Pick<AnalysisLimits, "extraIgnores" | "respectGitignore">,
    gitignoreTexts: Map<string, string> = new Map(),
  ) {
    this.patterns = ignore().add(IGNORED_PATTERNS);
    this.extra = ignore().add(limits.extraIgnores);
    if (limits.respectGitignore) {
      for (const [dir, text] of gitignoreTexts) this.gitignores.push({ dir, ig: ignore().add(text) });
      this.gitignores.sort((a, b) => a.dir.length - b.dir.length);
    }
  }

  check(path: string): IgnoreMatch | null {
    const parts = path.split("/");
    // 1. Built-in ignored directories (any depth).
    for (let i = 0; i < parts.length - 1; i++) {
      if (IGNORED_DIRECTORIES.has(parts[i] as string)) {
        return { reason: "ignored-directory", detail: "Ignored directory (default list)", groupPath: parts.slice(0, i + 1).join("/") + "/", isDirectory: true };
      }
    }
    // 2. Built-in file patterns.
    if (this.patterns.ignores(path)) {
      return { reason: "ignored-pattern", detail: "Generated or irrelevant file (default patterns)", groupPath: path, isDirectory: false };
    }
    // 3. User-configured patterns.
    const extraHit = this.firstIgnoredPrefix(this.extra, parts);
    if (extraHit) return { reason: "ignored-pattern", detail: "Matched an extra ignore pattern", ...extraHit };
    // 4. .gitignore files (root and nested).
    for (const { dir, ig } of this.gitignores) {
      if (dir !== "" && !path.startsWith(dir + "/")) continue;
      const relParts = dir === "" ? parts : parts.slice(dir.split("/").length);
      const hit = this.firstIgnoredPrefix(ig, relParts, dir);
      if (hit) return { reason: "gitignore", detail: `Matched ${dir ? dir + "/" : ""}.gitignore`, ...hit };
    }
    return null;
  }

  private firstIgnoredPrefix(ig: Ignore, parts: string[], baseDir = ""): { groupPath: string; isDirectory: boolean } | null {
    const base = baseDir ? baseDir + "/" : "";
    for (let i = 1; i <= parts.length; i++) {
      const rel = parts.slice(0, i).join("/");
      const isLast = i === parts.length;
      if (ig.ignores(isLast ? rel : rel + "/")) {
        return { groupPath: base + rel + (isLast ? "" : "/"), isDirectory: !isLast };
      }
    }
    return null;
  }
}

export type PlanDecision = { include: true } | { include: false };

/**
 * Applies ignore rules, extension and size limits to candidate files BEFORE they are read or
 * decompressed, and aggregates everything skipped so nothing disappears silently.
 */
export class ScanPlanner {
  private readonly groups = new Map<string, SkippedItem>();
  private included = 0;

  constructor(
    private readonly limits: AnalysisLimits,
    private readonly rules: IgnoreRules,
  ) {}

  get includedCount(): number {
    return this.included;
  }

  decide(path: string, size: number): PlanDecision {
    const ignored = this.rules.check(path);
    if (ignored) {
      this.record(ignored.groupPath, ignored.reason, ignored.detail, ignored.isDirectory);
      return { include: false };
    }
    if (BINARY_EXTENSIONS.has(extensionOf(path))) {
      this.record(path, "binary", `Binary file (${formatBytes(size)})`, false);
      return { include: false };
    }
    if (size > this.limits.maxFileBytes) {
      this.record(path, "too-large", `${formatBytes(size)} exceeds the ${formatBytes(this.limits.maxFileBytes)} per-file limit`, false);
      return { include: false };
    }
    if (this.included >= this.limits.maxFiles) {
      this.record(path, "over-file-limit", `More than ${this.limits.maxFiles} files; this one was not analyzed`, false);
      return { include: false };
    }
    this.included++;
    return { include: true };
  }

  /** Records a file skipped after it was read (e.g. binary content in a text-looking file). */
  recordSkip(path: string, reason: SkipReason, detail: string): void {
    this.record(path, reason, detail, false);
  }

  skipped(): SkippedItem[] {
    return [...this.groups.values()].sort((a, b) => a.path.localeCompare(b.path));
  }

  private record(groupPath: string, reason: SkipReason, detail: string, isDirectory: boolean): void {
    const existing = this.groups.get(groupPath);
    if (existing) {
      existing.fileCount = (existing.fileCount ?? 1) + 1;
      return;
    }
    // Cap the report size: beyond 500 distinct items, fold the rest into one counter.
    if (this.groups.size >= 500) {
      const overflow = this.groups.get("(other skipped files)") ?? { path: "(other skipped files)", reason, detail: "Further skipped items not listed individually", fileCount: 0 };
      overflow.fileCount = (overflow.fileCount ?? 0) + 1;
      this.groups.set("(other skipped files)", overflow);
      return;
    }
    this.groups.set(groupPath, { path: groupPath, reason, detail, ...(isDirectory ? { fileCount: 1 } : {}) });
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
