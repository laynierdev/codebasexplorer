import type { ApiEndpoint, SourceSymbol } from "@/domain/types";
import type { ParseResult } from "./parsers";
import type { BindingIndex } from "./bindings";

export interface ParsedFileResult {
  path: string;
  result: ParseResult;
}

const NEXT_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

/** Express-style endpoints (router calls plus mount prefixes) and Next.js file-convention endpoints. */
export function detectEndpoints(parsed: ParsedFileResult[], symbols: SourceSymbol[], bindings: BindingIndex): ApiEndpoint[] {
  const hasSymbol = (file: string, name: string) => symbols.some((s) => s.file === file && s.name === name);
  const endpoints: ApiEndpoint[] = [];

  // Mount table: "file::routerName" → { prefix, parent (file, name) }.
  interface Mount {
    prefix: string;
    parentFile: string;
    parentName: string;
  }
  const mountOf = new Map<string, Mount>();
  for (const { path, result } of parsed) {
    for (const m of result.mounts) {
      const target = bindings.lookup(path, m.routerName);
      if (target?.file) mountOf.set(`${target.file}::${target.imported}`, { prefix: m.prefix, parentFile: path, parentName: m.parent });
      else if (!target) mountOf.set(`${path}::${m.routerName}`, { prefix: m.prefix, parentFile: path, parentName: m.parent });
    }
  }
  const fullPrefix = (file: string, router: string, depth = 0): string => {
    const mount = mountOf.get(`${file}::${router}`);
    if (!mount || depth > 6) return "";
    return fullPrefix(mount.parentFile, mount.parentName, depth + 1) + mount.prefix;
  };

  for (const { path, result } of parsed) {
    for (const route of result.routes) {
      const prefix = fullPrefix(path, route.routerName);
      const joined = joinPath(prefix, route.path);
      const handler = route.handler && route.handler !== "(inline)" ? bindings.resolveName(path, route.handler, hasSymbol) : undefined;
      endpoints.push({
        method: route.method,
        path: joined,
        file: path,
        line: route.line,
        handler: route.handler,
        handlerFile: handler?.file,
        handlerSymbol: handler?.symbol,
        source: "router-call",
      });
    }
  }

  // Next.js app router: app/**/route.ts exporting GET/POST/...
  for (const { path } of parsed) {
    const app = /^(?:src\/)?app\/(.*\/)?route\.[jt]sx?$/.exec(path);
    if (app) {
      const urlPath = nextPath(app[1] ?? "");
      for (const s of symbols) {
        if (s.file === path && s.exported && NEXT_METHODS.has(s.name)) {
          endpoints.push({ method: s.name, path: urlPath, file: path, line: s.startLine, handler: s.name, handlerFile: path, handlerSymbol: s.name, source: "file-convention" });
        }
      }
      continue;
    }
    // Next.js pages router: pages/api/**
    const pages = /^(?:src\/)?pages\/api\/(.*)\.[jt]sx?$/.exec(path);
    if (pages) {
      const stem = (pages[1] ?? "").replace(/\/?index$/, "");
      const handler = symbols.find((s) => s.file === path && s.name === "default");
      endpoints.push({ method: "ALL", path: nextPath("api/" + stem), file: path, line: handler?.startLine ?? 1, handler: handler ? "default" : undefined, handlerFile: handler ? path : undefined, handlerSymbol: handler?.name, source: "file-convention" });
    }
  }
  return endpoints;
}

function joinPath(prefix: string, sub: string): string {
  const joined = `${prefix}/${sub}`.replace(/\/{2,}/g, "/");
  return joined.length > 1 ? joined.replace(/\/$/, "") : "/";
}

/** `users/[id]/(group)/posts/` → `/users/:id/posts`. */
function nextPath(dir: string): string {
  const segments = dir
    .split("/")
    .filter((s) => s !== "" && !(s.startsWith("(") && s.endsWith(")")) && !s.startsWith("@"))
    .map((s) => (s.startsWith("[...") ? "*" : s.startsWith("[") ? ":" + s.slice(1, -1) : s));
  return "/" + segments.join("/");
}
