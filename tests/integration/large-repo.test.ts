import { describe, expect, it } from "vitest";
import { analyzeEntries, analyzeZip } from "@/analysis/analyze";
import { resolveLimits } from "@/analysis/limits";
import { buildContextPack } from "@/ai/context/pack";
import { rankFiles } from "@/ai/context/retrieve";
import { buildFileGraph, buildModuleGraph, MAX_FILE_GRAPH_NODES } from "@/analysis/architecture";
import { AI_LIMITS } from "@/ai/schemas";
import { findCycles } from "@/lib/graph/analysis";
import { entriesFrom, makeZip } from "../helpers";

/** A synthetic monorepo-sized project: many modules in many directories, each importing its neighbors. */
function syntheticRepo(files: number, perDir = 20): Record<string, string> {
  const out: Record<string, string> = { "package.json": JSON.stringify({ name: "big", dependencies: { express: "4" } }) };
  for (let i = 0; i < files; i++) {
    const dir = `src/mod${Math.floor(i / perDir)}`;
    const next = i + 1 < files ? `../mod${Math.floor((i + 1) / perDir)}/file${i + 1}` : null;
    out[`${dir}/file${i}.ts`] = [
      next ? `import { value${i + 1} } from '${next}';` : "",
      `export interface Config${i} { id: number; name: string }`,
      `export function compute${i}(input: number): number {`,
      `  const base = ${i};`,
      `  return input + base${next ? ` + value${i + 1}` : ""};`,
      `}`,
      `export const value${i} = compute${i}(${i});`,
      "",
    ].join("\n");
  }
  return out;
}

describe("large repositories", () => {
  const COUNT = 3000;
  const sources = syntheticRepo(COUNT);

  it("analyzes thousands of files within a reasonable time and stays consistent", () => {
    const started = Date.now();
    const repo = analyzeEntries(entriesFrom(sources), { name: "big" });
    const elapsed = Date.now() - started;
    expect(repo.analysis.parsedFiles).toBe(COUNT);
    expect(repo.symbols.length).toBeGreaterThanOrEqual(COUNT * 3);
    expect(repo.dependencies).toHaveLength(COUNT - 1);
    expect(findCycles(repo)).toEqual([]);
    expect(elapsed).toBeLessThan(45_000);
  }, 60_000);

  it("keeps graphs, retrieval and AI context bounded no matter how large the repository is", () => {
    const repo = analyzeEntries(entriesFrom(sources), { name: "big" });

    const files = buildFileGraph(repo);
    expect(files.nodes.length).toBeLessThanOrEqual(MAX_FILE_GRAPH_NODES);
    expect(files.omitted).toBeGreaterThan(0);
    expect(buildModuleGraph(repo).nodes.length).toBeLessThanOrEqual(repo.modules.length + 5);

    const started = Date.now();
    const ranked = rankFiles(repo, "compute1500 value1500 config", { limit: 8 });
    expect(ranked[0]?.path).toBe("src/mod75/file1500.ts");
    const pack = buildContextPack(repo, { task: "question", question: "What does compute1500 do?" });
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(pack.files.length).toBeLessThanOrEqual(8);
    expect(JSON.stringify(pack).length).toBeLessThan(AI_LIMITS.maxPackChars);
  }, 60_000);

  it("respects the file-count limit and reports everything it did not analyze", () => {
    const zip = makeZip(syntheticRepo(500), 0);
    const repo = analyzeZip(zip, { name: "big", limits: { maxFiles: 100 } });
    expect(repo.files).toHaveLength(100);
    expect(repo.analysis.status).toBe("partial");
    const skipped = repo.skipped.filter((s) => s.reason === "over-file-limit");
    expect(skipped.length).toBe(401); // 501 files in the archive, 100 analyzed
    expect(repo.analysis.skippedFiles).toBe(401);
  });

  it("folds a very long skipped list into a bounded report", () => {
    const many: Record<string, string> = { "keep.ts": "export const a = 1;" };
    for (let i = 0; i < 700; i++) many[`gen/file${i}.ts`] = "export const b = 1;";
    const repo = analyzeZip(makeZip({ ...many, ".gitignore": "gen/file*\n" }, 0), { name: "x" });
    expect(repo.files.map((f) => f.path).sort()).toEqual([".gitignore", "keep.ts"]);
    expect(repo.skipped.length).toBeLessThanOrEqual(501);
    expect(repo.analysis.skippedFiles).toBe(700);
  });

  it("validates limits that would make no sense", () => {
    expect(() => resolveLimits({ maxFileBytes: 0 })).toThrow();
  });
});
