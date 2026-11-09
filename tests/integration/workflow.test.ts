import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { analyzeZip } from "@/analysis/analyze";
import { askAi } from "@/ai/client";
import { buildContextPack } from "@/ai/context/pack";
import { handleAiPost, resetRateLimiter } from "@/ai/http";
import { DEFAULT_LIMITS } from "@/analysis/limits";
import { applyImport, buildExport, parseImport, serializeExport } from "@/persistence/exportImport";
import { IndexedDbProjectStore } from "@/persistence/indexeddb";
import { MemoryProjectStore } from "@/persistence/memory";
import { metaFromRepository } from "@/persistence/projects";
import { DEMO_SOURCES } from "@/mock/demoSources";
import { makeZip } from "../helpers";

/** Calls the real route handler in-process, the way the browser would call /api/ai (mock mode, no credentials). */
const fetchViaHandler = (async (_url: string, init: RequestInit) => {
  return handleAiPost(new Request("http://localhost/api/ai", { method: "POST", headers: { "content-type": "application/json", host: "localhost" }, body: init.body as string }), {}, { AI_PROVIDER: "mock" });
}) as unknown as typeof fetch;

describe("complete user workflow (ZIP → analysis → AI → save → export → restore)", () => {
  it("works end to end without credentials", async () => {
    resetRateLimiter();

    // 1. Import a ZIP that contains noise (dependencies, build output, a binary)
    const zip = makeZip({
      ...Object.fromEntries(Object.entries(DEMO_SOURCES).map(([path, content]) => [`acme-main/${path}`, content])),
      "acme-main/node_modules/left-pad/index.js": "module.exports = 1;",
      "acme-main/dist/server.js": "var a = 1;",
      "acme-main/assets/logo.png": new Uint8Array([137, 80, 78, 71, 0, 0]),
    });
    const repo = analyzeZip(zip, { name: "acme-shop-api" });
    expect(repo.files.map((f) => f.path)).toContain("src/server.ts");
    expect(repo.files.some((f) => f.path.includes("node_modules") || f.path.startsWith("dist/"))).toBe(false);
    expect(repo.skipped.map((s) => s.path).sort()).toEqual(["assets/logo.png", "dist/", "node_modules/"]);
    expect(repo.endpoints).toHaveLength(7);
    expect(repo.flows.find((f) => f.trigger === "POST /api/orders")).toBeDefined();

    // 2. Ask the AI (mock provider, through the real HTTP handler) and verify the grounded answer
    const outcome = await askAi(repo, { task: "question", question: "Where is the payment charged?" }, { fetchImpl: fetchViaHandler });
    if (outcome.kind !== "answer") throw new Error("expected an answer");
    expect(outcome.meta.provider).toBe("mock");
    const refs = outcome.blocks.flatMap((b) => b.refs ?? []);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      const file = repo.files.find((f) => f.path === ref.file);
      expect(file, ref.file).toBeDefined();
      expect(ref.endLine).toBeLessThanOrEqual(file?.lineCount ?? 0);
    }
    expect(refs.some((r) => r.file === "src/services/payment.service.ts")).toBe(true);

    const impact = await askAi(repo, { task: "impact", target: "src/services/payment.service.ts" }, { fetchImpl: fetchViaHandler });
    if (impact.kind !== "answer") throw new Error("expected an answer");
    expect(impact.blocks.map((b) => b.text).join(" ")).toMatch(/order\.service\.ts/);

    // 3. Save in IndexedDB, reopen from a fresh connection (a "page reload")
    const factory = new IDBFactory();
    const first = await IndexedDbProjectStore.open("workflow", factory);
    const meta = metaFromRepository(repo, { id: "acme-1", origin: "zip", limits: DEFAULT_LIMITS });
    await first.save({ meta, repository: repo });
    await first.saveDoc("acme-1", { section: "overview", markdown: "# Overview", provider: "mock", warnings: [], savedAt: new Date().toISOString() });
    first.close();
    const reopened = await IndexedDbProjectStore.open("workflow", factory);
    const stored = await reopened.get("acme-1");
    expect(stored?.repository).toEqual(repo);

    // 4. Export, then restore into a different store and compare
    const text = serializeExport(buildExport([{ meta, repository: repo, docs: await reopened.listDocs("acme-1") }]));
    const other = new MemoryProjectStore();
    const report = await applyImport(other, parseImport(text, []), {});
    expect(report.outcomes.map((o) => o.result)).toEqual(["added"]);
    expect((await other.get("acme-1"))?.repository).toEqual(repo);
    expect((await other.listDocs("acme-1"))[0]?.markdown).toBe("# Overview");

    // 5. The restored repository is fully usable by the AI pipeline
    const restored = (await other.get("acme-1"))!.repository;
    expect(buildContextPack(restored, { task: "overview" }).files.length).toBeGreaterThan(0);

    // 6. Deleting removes everything
    await reopened.delete("acme-1");
    expect(await reopened.listDocs("acme-1")).toEqual([]);
    expect(await reopened.get("acme-1")).toBeNull();
    reopened.close();
  });
});
