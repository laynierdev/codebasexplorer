import { z } from "zod";

/**
 * Zod schemas are the source of truth for the domain model.
 * TypeScript types are inferred from them in `./types.ts`.
 */

export const SCHEMA_VERSION = 1;

export const LanguageSchema = z.enum([
  "typescript",
  "javascript",
  "json",
  "markdown",
  "sql",
  "python",
  "css",
  "html",
  "yaml",
  "shell",
  "go",
  "java",
  "rust",
  "ruby",
  "php",
  "csharp",
  "c",
  "cpp",
  "text",
]);

export const FileKindSchema = z.enum(["source", "test", "config", "doc", "script", "other"]);

export const LayerSchema = z.enum([
  "entry",
  "route",
  "controller",
  "service",
  "repository",
  "database",
  "middleware",
  "config",
  "model",
  "test",
  "external",
  "component",
  "page",
  "util",
  "other",
]);

export const SourceFileSchema = z.object({
  path: z.string().min(1),
  name: z.string().min(1),
  dir: z.string(),
  ext: z.string(),
  language: LanguageSchema,
  kind: FileKindSchema,
  layer: LayerSchema,
  size: z.number().int().nonnegative(),
  lineCount: z.number().int().nonnegative(),
  content: z.string(),
  /** Short human-readable purpose (heuristic in analysis; AI-enriched in Stage 3). */
  purpose: z.string(),
  /** True when the file was parsed for symbols and imports; otherwise it is text-only. */
  parsed: z.boolean(),
  /** Number of syntax diagnostics reported while parsing (0 when clean or not parsed). */
  parseIssues: z.number().int().nonnegative(),
});

export type TreeNode = {
  name: string;
  path: string;
  type: "dir" | "file";
  children?: TreeNode[];
};

export const TreeNodeSchema: z.ZodType<TreeNode> = z.lazy(() =>
  z.object({
    name: z.string(),
    path: z.string(),
    type: z.enum(["dir", "file"]),
    children: z.array(TreeNodeSchema).optional(),
  }),
);

export const DirectorySchema = z.object({
  path: z.string(),
  name: z.string(),
  depth: z.number().int().nonnegative(),
  fileCount: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
});

export const SymbolKindSchema = z.enum(["function", "class", "interface", "type", "enum", "const"]);

export const SourceSymbolSchema = z.object({
  name: z.string().min(1),
  kind: SymbolKindSchema,
  file: z.string(),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  exported: z.boolean(),
  /** Names of functions/objects this symbol calls (used to trace execution flows). */
  calls: z.array(z.string()).default([]),
});

export const FileDependencySchema = z.object({
  from: z.string(),
  to: z.string(),
  line: z.number().int().positive(),
  specifier: z.string(),
  typeOnly: z.boolean(),
  kind: z.enum(["import", "export", "require", "dynamic", "mock"]),
});

export const ExternalDependencySchema = z.object({
  name: z.string(),
  version: z.string(),
  dev: z.boolean(),
});

/** A source file importing a package from node_modules (not a project file). */
export const ExternalUsageSchema = z.object({
  file: z.string(),
  package: z.string(),
  line: z.number().int().positive(),
});

export const EntryPointSchema = z.object({
  path: z.string(),
  reason: z.string(),
});

export const SourceRefSchema = z.object({
  file: z.string(),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  symbol: z.string().optional(),
});

export const ApiEndpointSchema = z.object({
  method: z.string(),
  path: z.string(),
  file: z.string(),
  line: z.number().int().positive(),
  handler: z.string().optional(),
  handlerFile: z.string().optional(),
  handlerSymbol: z.string().optional(),
  source: z.enum(["router-call", "file-convention"]),
});

export const ModuleSchema = z.object({
  id: z.string(),
  path: z.string(),
  name: z.string(),
  layer: LayerSchema,
  fileCount: z.number().int().nonnegative(),
  lineCount: z.number().int().nonnegative(),
});

export const ModuleDependencySchema = z.object({
  from: z.string(),
  to: z.string(),
  count: z.number().int().positive(),
});

export const ArchNodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  layer: LayerSchema,
  file: z.string().optional(),
  description: z.string(),
});

export const ArchEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  label: z.string().optional(),
  /** "static" = derived from imports; "declared" = external integration detected from a package. */
  evidence: z.enum(["static", "declared"]),
});

export const FlowStepSchema = z.object({
  title: z.string(),
  description: z.string(),
  file: z.string(),
  symbol: z.string(),
  /** Explicit line range; when absent the range is resolved from the symbol. */
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
  /** "verified" = static call/import evidence; "inferred" = reasoning on top of the code. */
  evidence: z.enum(["verified", "inferred"]),
});

export const ExecutionFlowSchema = z.object({
  id: z.string(),
  title: z.string(),
  trigger: z.string(),
  summary: z.string(),
  steps: z.array(FlowStepSchema),
});

export const SkipReasonSchema = z.enum([
  "ignored-directory",
  "ignored-pattern",
  "gitignore",
  "binary",
  "too-large",
  "over-file-limit",
  "undecodable",
]);

export const SkippedItemSchema = z.object({
  path: z.string(),
  reason: SkipReasonSchema,
  detail: z.string(),
  /** Number of files inside when the item is a directory. */
  fileCount: z.number().int().nonnegative().optional(),
});

export const AnalysisResultSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  status: z.enum(["complete", "partial"]),
  analyzedFiles: z.number().int().nonnegative(),
  parsedFiles: z.number().int().nonnegative(),
  /** Text files that were indexed for search but not parsed (unsupported language). */
  textOnlyFiles: z.number().int().nonnegative(),
  skippedFiles: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative(),
  warnings: z.array(z.string()),
});

export const LanguageStatSchema = z.object({
  language: LanguageSchema,
  files: z.number().int().nonnegative(),
  lines: z.number().int().nonnegative(),
});

export const RepositorySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  files: z.array(SourceFileSchema),
  tree: TreeNodeSchema,
  directories: z.array(DirectorySchema),
  symbols: z.array(SourceSymbolSchema),
  dependencies: z.array(FileDependencySchema),
  externalDependencies: z.array(ExternalDependencySchema),
  externalUsages: z.array(ExternalUsageSchema),
  endpoints: z.array(ApiEndpointSchema),
  entryPoints: z.array(EntryPointSchema),
  technologies: z.array(z.string()),
  languages: z.array(LanguageStatSchema),
  modules: z.array(ModuleSchema),
  moduleDependencies: z.array(ModuleDependencySchema),
  flows: z.array(ExecutionFlowSchema),
  skipped: z.array(SkippedItemSchema),
  analysis: AnalysisResultSchema,
});

export const SearchModeSchema = z.enum(["files", "text", "symbols", "semantic"]);

export const SearchResultSchema = z.object({
  file: z.string(),
  line: z.number().int().positive(),
  title: z.string(),
  excerpt: z.string(),
  kind: SearchModeSchema,
  score: z.number().optional(),
});

export const ImpactResultSchema = z.object({
  target: z.string(),
  directDependents: z.array(z.string()),
  transitiveDependents: z.array(z.string()),
  affectedTests: z.array(z.string()),
  affectedRoutes: z.array(ApiEndpointSchema),
  dependencies: z.array(z.string()),
  cycles: z.array(z.array(z.string())),
});

/* ---------- Analysis limits (validated user input from Settings) ---------- */

export const AnalysisLimitsSchema = z.object({
  /** Maximum size of the uploaded archive (compressed). */
  maxArchiveBytes: z.number().int().positive(),
  /** Maximum total size of all entries once decompressed. */
  maxTotalBytes: z.number().int().positive(),
  /** Maximum size of a single file; larger files are skipped and reported. */
  maxFileBytes: z.number().int().positive(),
  /** Maximum number of entries in the archive (including ignored ones). */
  maxEntries: z.number().int().positive(),
  /** Maximum number of files that will be analyzed. */
  maxFiles: z.number().int().positive(),
  /** Maximum decompressed/compressed ratio per entry (zip-bomb guard). */
  maxCompressionRatio: z.number().positive(),
  maxPathLength: z.number().int().positive(),
  maxPathDepth: z.number().int().positive(),
  /** Extra ignore patterns (gitignore syntax) added to the defaults. */
  extraIgnores: z.array(z.string()),
  respectGitignore: z.boolean(),
});
