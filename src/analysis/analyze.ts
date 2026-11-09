import { SCHEMA_VERSION } from "@/domain/schemas";
import type {
  AnalysisLimits,
  Directory,
  ExternalDependency,
  ExternalUsage,
  FileDependency,
  Language,
  LanguageStat,
  Repository,
  SkippedItem,
  SourceFile,
  SourceSymbol,
  TreeNode,
} from "@/domain/types";
import { BindingIndex } from "./bindings";
import { countLines, decodeText, kindOf, languageOf, looksBinary } from "./classify";
import { describeFile } from "./describe";
import { detectEndpoints, type ParsedFileResult } from "./endpoints";
import { detectEntryPoints } from "./entrypoints";
import { detectFlows } from "./flows";
import { extensionOf } from "./ignore";
import { classifyLayer } from "./layers";
import { resolveLimits } from "./limits";
import { buildModules } from "./modules";
import { getParser } from "./parsers";
import { ImportResolver } from "./resolve";
import { detectTechnologies } from "./technologies";
import { extractZip, type RawEntry } from "./zip";

export interface AnalyzeOptions {
  /** Repository name; defaults to the archive/folder name. */
  name?: string;
  limits?: Partial<AnalysisLimits>;
  /** Items already skipped before analysis (ignored directories, oversized files...). */
  skipped?: SkippedItem[];
  onProgress?: (stage: string, done: number, total: number) => void;
}

/** Analyzes a ZIP archive. Pure function of the bytes: no I/O, no code execution. */
export function analyzeZip(bytes: Uint8Array, options: AnalyzeOptions = {}): Repository {
  const limits = resolveLimits(options.limits);
  options.onProgress?.("Extracting archive", 0, 1);
  const extraction = extractZip(bytes, limits);
  return analyzeEntries(extraction.entries, { ...options, limits, skipped: [...(options.skipped ?? []), ...extraction.skipped] });
}

/** Analyzes already-extracted files (ZIP entries or a selected folder). */
export function analyzeEntries(entries: RawEntry[], options: AnalyzeOptions = {}): Repository {
  const started = Date.now();
  resolveLimits(options.limits); // validates user-provided limits early (throws on invalid values)
  const progress = options.onProgress ?? (() => undefined);
  const skipped: SkippedItem[] = [...(options.skipped ?? [])];
  const warnings: string[] = [];

  // 1. Read and classify files.
  progress("Reading files", 0, entries.length);
  const files: SourceFile[] = [];
  for (const entry of [...entries].sort((a, b) => a.path.localeCompare(b.path))) {
    if (looksBinary(entry.data)) {
      skipped.push({ path: entry.path, reason: "binary", detail: `Binary content (${entry.data.byteLength} bytes)` });
      continue;
    }
    const content = decodeText(entry.data);
    if (content === null) {
      skipped.push({ path: entry.path, reason: "undecodable", detail: "Could not be decoded as UTF-8 or Windows-1252 text" });
      continue;
    }
    const language = languageOf(entry.path);
    const slash = entry.path.lastIndexOf("/");
    files.push({
      path: entry.path,
      name: entry.path.slice(slash + 1),
      dir: slash >= 0 ? entry.path.slice(0, slash) : "",
      ext: extensionOf(entry.path),
      language,
      kind: kindOf(entry.path, language),
      layer: classifyLayer(entry.path, language),
      size: entry.data.byteLength,
      lineCount: countLines(content),
      content,
      purpose: "",
      parsed: false,
      parseIssues: 0,
    });
  }

  // 2. Parse supported languages.
  const parsedResults: ParsedFileResult[] = [];
  const symbols: SourceSymbol[] = [];
  const parsable = files.filter((f) => getParser(f.language));
  parsable.forEach((file, i) => {
    if (i % 25 === 0) progress("Parsing source files", i, parsable.length);
    try {
      const result = getParser(file.language)?.parse(file.path, file.content);
      if (!result) return;
      file.parsed = true;
      file.parseIssues = result.issues;
      parsedResults.push({ path: file.path, result });
      for (const s of result.symbols) symbols.push({ ...s, file: file.path });
    } catch (err) {
      warnings.push(`Could not parse ${file.path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
  const syntaxIssueFiles = files.filter((f) => f.parseIssues > 0).length;
  if (syntaxIssueFiles > 0) warnings.push(`${syntaxIssueFiles} file(s) have syntax errors; their symbols and imports may be incomplete.`);

  // 3. Resolve imports into project dependencies, external usages and a binding index.
  progress("Resolving dependencies", 0, 1);
  const resolver = new ImportResolver({
    files: new Set(files.map((f) => f.path)),
    tsconfigText: (files.find((f) => f.path === "tsconfig.json") ?? files.find((f) => f.path === "jsconfig.json"))?.content,
  });
  const dependencies: FileDependency[] = [];
  const externalUsages: ExternalUsage[] = [];
  const bindings = new BindingIndex();
  const unresolved: string[] = [];
  for (const { path, result } of parsedResults) {
    for (const imp of result.imports) {
      const resolution = resolver.resolve(path, imp.specifier);
      if (resolution.kind === "file") {
        dependencies.push({ from: path, to: resolution.path, line: imp.line, specifier: imp.specifier, typeOnly: imp.typeOnly, kind: imp.kind });
        for (const b of imp.bindings) bindings.add(path, b.local, { file: resolution.path, imported: b.imported, specifier: imp.specifier });
      } else if (resolution.kind === "external") {
        externalUsages.push({ file: path, package: resolution.name, line: imp.line });
        for (const b of imp.bindings) bindings.add(path, b.local, { file: null, imported: b.imported, specifier: imp.specifier });
      } else if (resolution.kind === "unresolved") {
        unresolved.push(`${path}:${imp.line} → ${imp.specifier}`);
      }
    }
  }
  if (unresolved.length > 0) {
    warnings.push(`${unresolved.length} relative or aliased import(s) could not be resolved to a project file, for example ${unresolved.slice(0, 3).join("; ")}.`);
  }

  // 4. Project-level facts.
  const externalDependencies = readExternalDependencies(files);
  const technologies = detectTechnologies(files, new Set(externalDependencies.map((d) => d.name)));
  const entryPoints = detectEntryPoints(files, technologies);
  const endpoints = detectEndpoints(parsedResults, symbols, bindings);
  const flows = detectFlows(endpoints, files, symbols, bindings);
  const { modules, moduleDependencies } = buildModules(files, dependencies);

  // 5. Descriptions need symbols, so they come last.
  const symbolsByFile = new Map<string, SourceSymbol[]>();
  for (const s of symbols) symbolsByFile.set(s.file, [...(symbolsByFile.get(s.file) ?? []), s]);
  for (const f of files) f.purpose = describeFile(f, symbolsByFile.get(f.path) ?? []);

  // 6. Structure and statistics.
  const name = options.name?.trim() || "repository";
  const tree = buildTree(name, files);
  const parsedCount = files.filter((f) => f.parsed).length;
  const skippedFiles = skipped.reduce((s, i) => s + (i.fileCount ?? 1), 0);
  const partial = skipped.some((s) => s.reason === "too-large" || s.reason === "over-file-limit" || s.reason === "undecodable") || files.some((f) => getParser(f.language) && !f.parsed);

  const repository: Repository = {
    id: slug(name),
    name,
    description: readDescription(files),
    files,
    tree,
    directories: buildDirectories(files),
    symbols,
    dependencies,
    externalDependencies,
    externalUsages,
    endpoints,
    entryPoints,
    technologies,
    languages: languageStats(files),
    modules,
    moduleDependencies,
    flows,
    skipped,
    analysis: {
      schemaVersion: SCHEMA_VERSION,
      status: partial ? "partial" : "complete",
      analyzedFiles: files.length,
      parsedFiles: parsedCount,
      textOnlyFiles: files.length - parsedCount,
      skippedFiles,
      durationMs: Date.now() - started,
      warnings,
    },
  };
  progress("Done", 1, 1);
  return repository;
}

export { validateRepository } from "./validate";

function readExternalDependencies(files: SourceFile[]): ExternalDependency[] {
  const manifest = files.find((f) => f.path === "package.json");
  if (!manifest) return [];
  try {
    const json = JSON.parse(manifest.content) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const list = (record: Record<string, string> | undefined, dev: boolean) =>
      Object.entries(record ?? {})
        .filter(([, version]) => typeof version === "string")
        .map(([name, version]) => ({ name, version, dev }));
    return [...list(json.dependencies, false), ...list(json.devDependencies, true)];
  } catch {
    return [];
  }
}

function readDescription(files: SourceFile[]): string {
  const manifest = files.find((f) => f.path === "package.json");
  if (manifest) {
    try {
      const description = (JSON.parse(manifest.content) as { description?: unknown }).description;
      if (typeof description === "string" && description.trim()) return description.trim().slice(0, 300);
    } catch {
      // ignore malformed manifest
    }
  }
  return "";
}

function buildTree(name: string, files: SourceFile[]): TreeNode {
  const root: TreeNode = { name, path: "", type: "dir", children: [] };
  for (const file of files) {
    const parts = file.path.split("/");
    let node = root;
    parts.forEach((part, i) => {
      const path = parts.slice(0, i + 1).join("/");
      const isFile = i === parts.length - 1;
      node.children ??= [];
      let child = node.children.find((c) => c.name === part);
      if (!child) {
        child = { name: part, path, type: isFile ? "file" : "dir", ...(isFile ? {} : { children: [] }) };
        node.children.push(child);
      }
      node = child;
    });
  }
  const sort = (n: TreeNode) => {
    n.children?.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
    n.children?.forEach(sort);
  };
  sort(root);
  return root;
}

function buildDirectories(files: SourceFile[]): Directory[] {
  const dirs = new Map<string, Directory>();
  for (const f of files) {
    const parts = f.dir === "" ? [] : f.dir.split("/");
    for (let i = 1; i <= parts.length; i++) {
      const path = parts.slice(0, i).join("/");
      const d = dirs.get(path) ?? { path, name: parts[i - 1] as string, depth: i, fileCount: 0, totalBytes: 0 };
      d.fileCount += 1;
      d.totalBytes += f.size;
      dirs.set(path, d);
    }
  }
  return [...dirs.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function languageStats(files: SourceFile[]): LanguageStat[] {
  const stats = new Map<Language, LanguageStat>();
  for (const f of files) {
    const s = stats.get(f.language) ?? { language: f.language, files: 0, lines: 0 };
    s.files += 1;
    s.lines += f.lineCount;
    stats.set(f.language, s);
  }
  return [...stats.values()].sort((a, b) => b.lines - a.lines);
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "repository";
}
