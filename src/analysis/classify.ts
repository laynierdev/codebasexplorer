import type { FileKind, Language } from "@/domain/types";
import { extensionOf } from "./ignore";

const EXTENSION_LANGUAGE: Record<string, Language> = {
  ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  json: "json", jsonc: "json", json5: "json",
  md: "markdown", mdx: "markdown", markdown: "markdown",
  sql: "sql",
  py: "python", pyi: "python",
  css: "css", scss: "css", sass: "css", less: "css",
  html: "html", htm: "html",
  yml: "yaml", yaml: "yaml",
  sh: "shell", bash: "shell", zsh: "shell", ps1: "shell", bat: "shell", cmd: "shell",
  go: "go",
  java: "java", kt: "java", kts: "java",
  rs: "rust",
  rb: "ruby",
  php: "php",
  cs: "csharp",
  c: "c", h: "c",
  cpp: "cpp", cc: "cpp", cxx: "cpp", hpp: "cpp",
};

const FILENAME_LANGUAGE: Record<string, Language> = {
  Dockerfile: "shell",
  Makefile: "shell",
};

export function languageOf(path: string): Language {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const byName = FILENAME_LANGUAGE[name];
  if (byName) return byName;
  return EXTENSION_LANGUAGE[extensionOf(path)] ?? "text";
}

const TEST_PATH = /(^|\/)(tests?|__tests__|spec|e2e)\//i;
const TEST_FILE = /\.(test|spec)\.[a-z]+$/i;
const CONFIG_FILE = /(^|\/)(package\.json|tsconfig[^/]*\.json|jsconfig\.json|\.env[^/]*|\.eslintrc[^/]*|eslint\.config\.[a-z]+|\.prettierrc[^/]*|prettier\.config\.[a-z]+|[^/]*\.config\.[a-z]+|Dockerfile|docker-compose[^/]*\.ya?ml|\.gitignore|\.npmrc|\.nvmrc|go\.mod|Cargo\.toml|pom\.xml|requirements\.txt|pyproject\.toml|composer\.json|Gemfile)$/i;

export function kindOf(path: string, language: Language): FileKind {
  if (TEST_PATH.test(path) || TEST_FILE.test(path)) return "test";
  if (CONFIG_FILE.test(path)) return "config";
  if (language === "markdown") return "doc";
  if (language === "shell" || path.startsWith("scripts/") || path.startsWith("bin/")) return "script";
  if (language === "json" || language === "yaml" || language === "text") return "other";
  return "source";
}

/** True when the bytes look like a binary file (NUL byte or a high ratio of control characters). */
export function looksBinary(data: Uint8Array): boolean {
  const sample = Math.min(data.length, 8000);
  if (sample === 0) return false;
  let suspicious = 0;
  for (let i = 0; i < sample; i++) {
    const b = data[i] as number;
    if (b === 0) return true;
    if (b < 7 || (b > 13 && b < 32 && b !== 27)) suspicious++;
  }
  return suspicious / sample > 0.1;
}

const utf8 = new TextDecoder("utf-8", { fatal: true });
const latin1 = new TextDecoder("windows-1252");

/** Decodes text, stripping a BOM. Returns null if the bytes cannot be decoded sensibly. */
export function decodeText(data: Uint8Array): string | null {
  try {
    return stripBom(utf8.decode(data));
  } catch {
    try {
      const text = latin1.decode(data);
      const replacements = (text.match(/�/g) ?? []).length;
      return replacements / Math.max(text.length, 1) > 0.01 ? null : stripBom(text);
    } catch {
      return null;
    }
  }
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function countLines(content: string): number {
  if (content === "") return 0;
  const lines = content.split("\n").length;
  return content.endsWith("\n") ? lines - 1 : lines;
}
