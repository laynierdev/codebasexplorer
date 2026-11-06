import ts from "typescript";

export type Resolution =
  | { kind: "file"; path: string }
  | { kind: "external"; name: string }
  | { kind: "builtin"; name: string }
  | { kind: "unresolved"; specifier: string };

const NODE_BUILTINS = new Set([
  "assert", "async_hooks", "buffer", "child_process", "cluster", "console", "constants", "crypto", "dgram", "dns", "domain", "events", "fs", "http", "http2", "https",
  "inspector", "module", "net", "os", "path", "perf_hooks", "process", "punycode", "querystring", "readline", "repl", "stream", "string_decoder", "timers", "tls",
  "trace_events", "tty", "url", "util", "v8", "vm", "wasi", "worker_threads", "zlib",
]);

const EXTENSIONS = [".ts", ".tsx", ".d.ts", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".json"];
const JS_TO_TS: Record<string, string[]> = {
  ".js": [".ts", ".tsx"],
  ".jsx": [".tsx"],
  ".mjs": [".mts"],
  ".cjs": [".cts"],
};

interface PathAlias {
  pattern: string;
  targets: string[];
}

export interface ResolverOptions {
  /** All analyzed file paths (POSIX, relative to the repository root). */
  files: Set<string>;
  /** Contents of tsconfig.json / jsconfig.json at the repository root, if present. */
  tsconfigText?: string;
}

export class ImportResolver {
  private readonly files: Set<string>;
  private readonly baseUrl: string | null;
  private readonly aliases: PathAlias[];

  constructor(options: ResolverOptions) {
    this.files = options.files;
    const config = parseTsconfig(options.tsconfigText);
    this.baseUrl = config.baseUrl;
    this.aliases = config.aliases;
  }

  resolve(fromFile: string, specifier: string): Resolution {
    if (specifier.startsWith("node:")) return { kind: "builtin", name: specifier.slice(5) };

    if (specifier.startsWith("./") || specifier.startsWith("../") || specifier === "." || specifier === "..") {
      const dir = fromFile.includes("/") ? fromFile.slice(0, fromFile.lastIndexOf("/")) : "";
      const hit = this.tryFile(join(dir, specifier));
      return hit ? { kind: "file", path: hit } : { kind: "unresolved", specifier };
    }

    // tsconfig `paths` aliases, then `baseUrl` imports.
    for (const alias of this.aliases) {
      const captured = matchAlias(alias.pattern, specifier);
      if (captured === null) continue;
      for (const target of alias.targets) {
        const hit = this.tryFile(normalize(target.replace("*", captured)));
        if (hit) return { kind: "file", path: hit };
      }
    }
    if (this.baseUrl !== null) {
      const hit = this.tryFile(join(this.baseUrl, specifier));
      if (hit) return { kind: "file", path: hit };
    }

    const name = packageName(specifier);
    if (NODE_BUILTINS.has(name)) return { kind: "builtin", name };
    return { kind: "external", name };
  }

  /** Tries the path as-is, with known extensions, with .js→.ts mapping and as a directory index. */
  private tryFile(base: string): string | null {
    const path = normalize(base);
    if (this.files.has(path)) return path;
    for (const ext of EXTENSIONS) if (this.files.has(path + ext)) return path + ext;
    const dot = path.lastIndexOf(".");
    if (dot > 0) {
      const mapped = JS_TO_TS[path.slice(dot)];
      if (mapped) for (const ext of mapped) if (this.files.has(path.slice(0, dot) + ext)) return path.slice(0, dot) + ext;
    }
    for (const ext of EXTENSIONS) if (this.files.has(`${path}/index${ext}`)) return `${path}/index${ext}`;
    return null;
  }
}

export function packageName(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] as string);
}

function join(dir: string, rel: string): string {
  return normalize(dir ? `${dir}/${rel}` : rel);
}

function normalize(path: string): string {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

function matchAlias(pattern: string, specifier: string): string | null {
  const star = pattern.indexOf("*");
  if (star === -1) return pattern === specifier ? "" : null;
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  if (specifier.startsWith(prefix) && specifier.endsWith(suffix) && specifier.length >= prefix.length + suffix.length) {
    return specifier.slice(prefix.length, specifier.length - suffix.length);
  }
  return null;
}

function parseTsconfig(text: string | undefined): { baseUrl: string | null; aliases: PathAlias[] } {
  if (!text) return { baseUrl: null, aliases: [] };
  const parsed = ts.parseConfigFileTextToJson("tsconfig.json", text);
  const options = (parsed.config as { compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } } | undefined)?.compilerOptions;
  if (!options) return { baseUrl: null, aliases: [] };
  const baseUrl = typeof options.baseUrl === "string" ? normalize(options.baseUrl) : null;
  const aliases: PathAlias[] = [];
  for (const [pattern, targets] of Object.entries(options.paths ?? {})) {
    if (!Array.isArray(targets)) continue;
    // Paths are relative to baseUrl when set, otherwise to the tsconfig directory (the repository root).
    aliases.push({ pattern, targets: targets.filter((t) => typeof t === "string").map((t) => (baseUrl ? join(baseUrl, t) : normalize(t))) });
  }
  return { baseUrl, aliases };
}
