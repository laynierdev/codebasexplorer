/**
 * Domain types for CodebaseXplorer.
 * Stage 1 uses plain TypeScript types; Stage 2 will turn these into Zod schemas
 * (the source of truth) and infer the types from them.
 */

export type Language = "typescript" | "javascript" | "json" | "markdown" | "sql" | "python" | "text";

export type FileKind = "source" | "test" | "config" | "doc" | "script";

export interface SourceFile {
  path: string;
  name: string;
  dir: string;
  ext: string;
  language: Language;
  kind: FileKind;
  size: number;
  lineCount: number;
  content: string;
  /** Short human-readable purpose (mock: hand-written; later: AI + heuristics). */
  purpose: string;
  /** True when the file has been parsed for symbols/dependencies (otherwise text-only). */
  parsed: boolean;
}

export interface TreeNode {
  name: string;
  path: string;
  type: "dir" | "file";
  children?: TreeNode[];
}

export type SymbolKind = "function" | "class" | "interface" | "type" | "const";

export interface SourceSymbol {
  name: string;
  kind: SymbolKind;
  file: string;
  startLine: number;
  endLine: number;
  exported: boolean;
}

export interface FileDependency {
  from: string;
  to: string;
  line: number;
  typeOnly: boolean;
}

export interface ExternalDependency {
  name: string;
  version: string;
  dev: boolean;
}

export type Layer =
  | "entry"
  | "route"
  | "controller"
  | "service"
  | "repository"
  | "database"
  | "middleware"
  | "config"
  | "model"
  | "test"
  | "external"
  | "other";

export interface ArchNode {
  id: string;
  label: string;
  layer: Layer;
  /** Source file this node maps to (absent for external systems). */
  file?: string;
  description: string;
}

export interface ArchEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  /** "static" = derived from imports; "declared" = external integration detected from a package. */
  evidence: "static" | "declared";
}

export interface SourceRef {
  file: string;
  startLine: number;
  endLine: number;
  symbol?: string;
}

export interface ApiEndpoint {
  method: string;
  path: string;
  file: string;
  line: number;
  handler?: string;
}

export type SkipReason = "ignored-directory" | "ignored-pattern" | "binary" | "too-large" | "unsupported-language";

export interface SkippedItem {
  path: string;
  reason: SkipReason;
  detail: string;
  /** Number of files inside when the item is a directory. */
  fileCount?: number;
}

export interface Repository {
  id: string;
  name: string;
  description: string;
  files: SourceFile[];
  tree: TreeNode;
  symbols: SourceSymbol[];
  dependencies: FileDependency[];
  externalDependencies: ExternalDependency[];
  endpoints: ApiEndpoint[];
  entryPoints: string[];
  technologies: string[];
  languages: { language: Language; files: number; lines: number }[];
  directoryCount: number;
  skipped: SkippedItem[];
  analysis: { status: "complete" | "partial"; analyzedFiles: number; parsedFiles: number; durationMs: number };
}

/* ---------- Execution flows ---------- */

export interface FlowStep {
  title: string;
  description: string;
  file: string;
  symbol: string;
  /** "verified" = every hop is a static call/import chain; "inferred" = reasoning on top of the code. */
  evidence: "verified" | "inferred";
}

export interface ExecutionFlow {
  id: string;
  title: string;
  trigger: string;
  summary: string;
  steps: FlowStep[];
}

/* ---------- Assistant ---------- */

export type ClaimKind = "fact" | "inference" | "recommendation" | "uncertain";

export interface AnswerBlock {
  kind: ClaimKind;
  text: string;
  refs?: SourceRef[];
}

export interface AssistantMessage {
  id: string;
  role: "user" | "assistant";
  text?: string;
  blocks?: AnswerBlock[];
  provider?: "mock" | "gemini";
}

/* ---------- Search ---------- */

export type SearchMode = "files" | "text" | "symbols" | "semantic";

export interface SearchResult {
  file: string;
  line: number;
  title: string;
  excerpt: string;
  kind: SearchMode;
  score?: number;
}

/* ---------- Impact ---------- */

export interface ImpactResult {
  target: string;
  directDependents: string[];
  transitiveDependents: string[];
  affectedTests: string[];
  affectedRoutes: ApiEndpoint[];
  dependencies: string[];
  cycles: string[][];
}
