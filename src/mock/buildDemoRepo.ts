import type {
  ApiEndpoint,
  ExternalDependency,
  FileDependency,
  FileKind,
  Language,
  Repository,
  SkippedItem,
  SourceFile,
  SourceSymbol,
  TreeNode,
} from "@/domain/types";
import { DEMO_PURPOSES, DEMO_SKIPPED, DEMO_SOURCES } from "./demoSources";

/**
 * Builds the demo Repository from embedded sources using lightweight, deterministic
 * text analysis. This is MOCK scaffolding for the Stage 1 prototype: Stage 2 replaces it
 * with the real scanner/parsers in `src/analysis`.
 */

const EXT_LANGUAGE: Record<string, Language> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  json: "json",
  md: "markdown",
  sql: "sql",
  py: "python",
};

function extOf(path: string): string {
  const name = path.split("/").pop() ?? path;
  const idx = name.lastIndexOf(".");
  return idx > 0 ? name.slice(idx + 1) : "";
}

function kindOf(path: string): FileKind {
  if (path.startsWith("tests/")) return "test";
  if (path.startsWith("scripts/")) return "script";
  if (path.endsWith(".md")) return "doc";
  if (path.endsWith(".json") || path.startsWith(".env")) return "config";
  return "source";
}

function buildFiles(): SourceFile[] {
  return Object.keys(DEMO_SOURCES)
    .sort()
    .map((path) => {
      const content = DEMO_SOURCES[path] ?? "";
      const ext = extOf(path);
      const language = EXT_LANGUAGE[ext] ?? "text";
      const slash = path.lastIndexOf("/");
      return {
        path,
        name: path.slice(slash + 1),
        dir: slash >= 0 ? path.slice(0, slash) : "",
        ext,
        language,
        kind: kindOf(path),
        size: content.length,
        lineCount: content.split("\n").length - (content.endsWith("\n") ? 1 : 0),
        content,
        purpose: DEMO_PURPOSES[path] ?? "No description available.",
        parsed: language === "typescript",
      };
    });
}

function buildTree(files: SourceFile[]): TreeNode {
  const root: TreeNode = { name: "acme-shop-api", path: "", type: "dir", children: [] };
  for (const file of files) {
    const parts = file.path.split("/");
    let node = root;
    parts.forEach((part, i) => {
      const path = parts.slice(0, i + 1).join("/");
      const isFile = i === parts.length - 1;
      node.children ??= [];
      let child = node.children.find((c) => c.name === part);
      if (!child) {
        child = { name: part, path, type: isFile ? "file" : "dir", children: isFile ? undefined : [] };
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

function countDirs(node: TreeNode): number {
  return (node.children ?? []).reduce((sum, c) => sum + (c.type === "dir" ? 1 + countDirs(c) : 0), 0);
}

/** Removes quoted string contents so brace counting ignores them. */
function stripStrings(line: string): string {
  return line.replace(/'(?:[^'\\]|\\.)*'/g, "''").replace(/"(?:[^"\\]|\\.)*"/g, '""');
}

function findEndLine(lines: string[], startIdx: number): number {
  let depth = 0;
  for (let i = startIdx; i < lines.length; i++) {
    const line = stripStrings(lines[i] ?? "");
    for (const ch of line) {
      if ("({[".includes(ch)) depth++;
      else if (")}]".includes(ch)) depth--;
    }
    const trimmed = line.trim();
    if (depth <= 0 && (trimmed.endsWith(";") || trimmed.endsWith("}"))) return i + 1;
  }
  return startIdx + 1;
}

const SYMBOL_PATTERNS: { kind: SourceSymbol["kind"]; re: RegExp }[] = [
  { kind: "class", re: /^(export\s+)?class\s+(\w+)/ },
  { kind: "function", re: /^(export\s+)?(?:async\s+)?function\s+(\w+)/ },
  { kind: "interface", re: /^(export\s+)?interface\s+(\w+)/ },
  { kind: "type", re: /^(export\s+)?type\s+(\w+)/ },
  { kind: "const", re: /^(export\s+)?const\s+(\w+)/ },
];

function extractSymbols(file: SourceFile): SourceSymbol[] {
  if (!file.parsed) return [];
  const lines = file.content.split("\n");
  const symbols: SourceSymbol[] = [];
  lines.forEach((line, idx) => {
    for (const { kind, re } of SYMBOL_PATTERNS) {
      const match = re.exec(line);
      if (match) {
        symbols.push({
          name: match[2] ?? "",
          kind,
          file: file.path,
          startLine: idx + 1,
          endLine: findEndLine(lines, idx),
          exported: Boolean(match[1]),
        });
        break;
      }
    }
  });
  return symbols;
}

function resolveImport(fromPath: string, spec: string, known: Set<string>): string | null {
  const segments = fromPath.split("/").slice(0, -1);
  for (const part of spec.split("/")) {
    if (part === ".") continue;
    if (part === "..") segments.pop();
    else segments.push(part);
  }
  const base = segments.join("/");
  for (const candidate of [base + ".ts", base + "/index.ts", base]) {
    if (known.has(candidate)) return candidate;
  }
  return null;
}

function extractDependencies(files: SourceFile[]): FileDependency[] {
  const known = new Set(files.map((f) => f.path));
  const deps: FileDependency[] = [];
  const re = /^import\s+(type\s+)?[^;]*?from\s+'(\.[^']+)'/;
  for (const file of files) {
    if (!file.parsed) continue;
    file.content.split("\n").forEach((line, idx) => {
      const match = re.exec(line);
      if (!match) return;
      const target = resolveImport(file.path, match[2] ?? "", known);
      if (target) deps.push({ from: file.path, to: target, line: idx + 1, typeOnly: Boolean(match[1]) });
    });
  }
  return deps;
}

function extractExternalDependencies(files: SourceFile[]): ExternalDependency[] {
  const manifest = files.find((f) => f.path === "package.json");
  if (!manifest) return [];
  const json = JSON.parse(manifest.content) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  return [
    ...Object.entries(json.dependencies ?? {}).map(([name, version]) => ({ name, version, dev: false })),
    ...Object.entries(json.devDependencies ?? {}).map(([name, version]) => ({ name, version, dev: true })),
  ];
}

function extractEndpoints(files: SourceFile[]): ApiEndpoint[] {
  const index = files.find((f) => f.path === "src/routes/index.ts");
  const prefixByRouter = new Map<string, string>();
  for (const m of index?.content.matchAll(/app\.use\('([^']+)',\s*(\w+)\)/g) ?? []) {
    prefixByRouter.set(m[2] ?? "", m[1] ?? "");
  }
  const endpoints: ApiEndpoint[] = [];
  const re = /(\w+Router)\.(get|post|put|patch|delete)\('([^']*)'(?:,\s*([^)]*))?\)/;
  for (const file of files) {
    if (!file.path.startsWith("src/routes/") || file.path === "src/routes/index.ts") continue;
    file.content.split("\n").forEach((line, idx) => {
      const m = re.exec(line);
      if (!m) return;
      const prefix = prefixByRouter.get(m[1] ?? "") ?? "";
      const sub = m[3] === "/" ? "" : (m[3] ?? "");
      const handler = (m[4] ?? "").split(",").pop()?.trim();
      endpoints.push({ method: (m[2] ?? "").toUpperCase(), path: prefix + sub, file: file.path, line: idx + 1, handler });
    });
  }
  return endpoints;
}

const TECH_BY_PACKAGE: Record<string, string> = {
  express: "Express",
  pg: "PostgreSQL (pg)",
  jsonwebtoken: "JWT",
  bcryptjs: "bcrypt",
  stripe: "Stripe",
  nodemailer: "Nodemailer",
  zod: "Zod",
  vitest: "Vitest",
  typescript: "TypeScript",
};

function buildDemoRepository(): Repository {
  const files = buildFiles();
  const tree = buildTree(files);
  const externalDependencies = extractExternalDependencies(files);

  const byLanguage = new Map<Language, { files: number; lines: number }>();
  for (const f of files) {
    const entry = byLanguage.get(f.language) ?? { files: 0, lines: 0 };
    entry.files += 1;
    entry.lines += f.lineCount;
    byLanguage.set(f.language, entry);
  }

  return {
    id: "acme-shop-api",
    name: "acme-shop-api",
    description: "REST API for an online shop: authentication, product catalog and orders.",
    files,
    tree,
    symbols: files.flatMap(extractSymbols),
    dependencies: extractDependencies(files),
    externalDependencies,
    endpoints: extractEndpoints(files),
    entryPoints: ["src/server.ts"],
    technologies: externalDependencies.map((d) => TECH_BY_PACKAGE[d.name]).filter((t): t is string => Boolean(t)),
    languages: [...byLanguage.entries()]
      .map(([language, v]) => ({ language, ...v }))
      .sort((a, b) => b.lines - a.lines),
    directoryCount: countDirs(tree),
    skipped: DEMO_SKIPPED.map((s) => ({ ...s })) as SkippedItem[],
    analysis: {
      status: "partial",
      analyzedFiles: files.length,
      parsedFiles: files.filter((f) => f.parsed).length,
      durationMs: 842,
    },
  };
}

export const demoRepository: Repository = buildDemoRepository();
