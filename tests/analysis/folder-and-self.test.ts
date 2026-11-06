import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeEntries, validateRepository } from "@/analysis/analyze";
import { collectFolderEntries, type PickedFile } from "@/analysis/folder";
import { ArchiveError, resolveLimits } from "@/analysis/limits";
import { findCycles } from "@/lib/graph/analysis";

const enc = new TextEncoder();
const picked = (files: Record<string, string>): PickedFile[] =>
  Object.entries(files).map(([path, content]) => ({ path, size: content.length, read: async () => enc.encode(content).buffer as ArrayBuffer }));

describe("collectFolderEntries (folder picker import)", () => {
  const limits = resolveLimits();

  it("applies ignore rules before reading files and reports what was skipped", async () => {
    let reads = 0;
    const files = picked({ "src/a.ts": "1", "node_modules/x/index.js": "2", ".git/HEAD": "3", "dist/out.js": "4", "logo.png": "5" }).map((f) => ({
      ...f,
      read: async () => {
        reads++;
        return enc.encode("x").buffer as ArrayBuffer;
      },
    }));
    const { entries, skipped } = await collectFolderEntries(files, limits);
    expect(entries.map((e) => e.path)).toEqual(["src/a.ts"]);
    expect(reads).toBe(1); // ignored files and binaries are never read into memory
    expect(skipped.map((s) => s.path).sort()).toEqual([".git/", "dist/", "logo.png", "node_modules/"]);
  });

  it("respects .gitignore found in the folder", async () => {
    const { entries } = await collectFolderEntries(picked({ ".gitignore": "secret/\n", "secret/key.ts": "x", "src/a.ts": "y" }), limits);
    expect(entries.map((e) => e.path).sort()).toEqual([".gitignore", "src/a.ts"]);
  });

  it("enforces size and count limits", async () => {
    const small = resolveLimits({ maxFileBytes: 5, maxFiles: 2 });
    const { entries, skipped } = await collectFolderEntries(picked({ "a.ts": "1", "b.ts": "2", "c.ts": "3", "big.ts": "123456789" }), small);
    expect(entries).toHaveLength(2);
    expect(skipped.map((s) => s.reason).sort()).toEqual(["over-file-limit", "too-large"]);
  });

  it("rejects empty and oversized folders", async () => {
    await expect(collectFolderEntries([], limits)).rejects.toBeInstanceOf(ArchiveError);
    await expect(collectFolderEntries(picked({ a: "1", b: "2", c: "3" }), resolveLimits({ maxEntries: 2 }))).rejects.toMatchObject({ code: "too-many-entries" });
  });

  it("feeds the analyzer end to end", async () => {
    const { entries, skipped } = await collectFolderEntries(picked({ "src/a.ts": "import { b } from './b';\nexport const a = b;\n", "src/b.ts": "export const b = 1;\n", "node_modules/p/i.js": "x" }), limits);
    const repo = analyzeEntries(entries, { name: "picked", skipped });
    expect(repo.dependencies).toHaveLength(1);
    expect(repo.skipped).toHaveLength(1);
  });
});

/** Dogfooding: analyze this project's own source, a real-world TypeScript + path alias codebase. */
describe("analysis of CodebaseXplorer itself", () => {
  const root = join(__dirname, "..", "..");
  const collect = (dir: string, out: { path: string; data: Uint8Array }[] = []) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) collect(full, out);
      else out.push({ path: relative(root, full).replace(/\\/g, "/"), data: new Uint8Array(readFileSync(full)) });
    }
    return out;
  };
  const entries = [...collect(join(root, "src")), ...collect(join(root, "tests")), { path: "tsconfig.json", data: new Uint8Array(readFileSync(join(root, "tsconfig.json"))) }, { path: "package.json", data: new Uint8Array(readFileSync(join(root, "package.json"))) }];
  const repo = analyzeEntries(entries, { name: "codebasexplorer" });

  it("resolves every @/ alias import to a project file", () => {
    expect(repo.analysis.warnings.filter((w) => w.includes("could not be resolved"))).toEqual([]);
    expect(repo.dependencies.some((d) => d.from === "src/analysis/analyze.ts" && d.to === "src/analysis/zip.ts" && d.specifier === "./zip")).toBe(true);
    expect(repo.dependencies.some((d) => d.from === "src/app/page.tsx" && d.specifier.startsWith("@/"))).toBe(true);
  });

  it("parses TSX and finds a sane amount of structure", () => {
    expect(repo.analysis.parsedFiles).toBeGreaterThan(60);
    expect(repo.files.filter((f) => f.parseIssues > 0)).toEqual([]);
    expect(repo.symbols.some((s) => s.file === "src/analysis/analyze.ts" && s.name === "analyzeEntries" && s.exported)).toBe(true);
    expect(repo.technologies).toEqual(expect.arrayContaining(["Next.js", "React", "Zod", "TypeScript", "Vitest"]));
  });

  it("finds no circular dependencies in its own code and validates against the schema", () => {
    expect(findCycles(repo)).toEqual([]);
    expect(() => validateRepository(repo)).not.toThrow();
  });
});
