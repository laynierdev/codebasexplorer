import { describe, expect, it } from "vitest";
import { DEFAULT_LIMITS } from "@/analysis/limits";
import { StorageError } from "@/persistence/errors";
import { applyImport, buildExport, exportFileName, findStrippedKeys, parseImport, serializeExport, type Resolution } from "@/persistence/exportImport";
import { checkRepositoryIntegrity } from "@/persistence/integrity";
import { ImportError, migrateExport, type Migration } from "@/persistence/migrate";
import { MemoryProjectStore } from "@/persistence/memory";
import { metaFromRepository } from "@/persistence/projects";
import { EXPORT_FORMAT, EXPORT_SCHEMA_VERSION, type StoredDoc } from "@/persistence/schemas";
import type { ProjectStore, StoredProject } from "@/persistence/store";
import { demoRepository as repo } from "@/mock/buildDemoRepo";

const NOW = new Date("2026-11-10T12:00:00.000Z");
const meta = (id: string, name = id) => metaFromRepository(repo, { id, name, origin: "zip", limits: DEFAULT_LIMITS, now: NOW });
const doc = (section: StoredDoc["section"], markdown = "# doc"): StoredDoc => ({ section, markdown, provider: "gemini", model: "m", warnings: ["w"], savedAt: NOW.toISOString() });
const entry = (id: string, docs: StoredDoc[] = []) => ({ meta: meta(id), repository: repo, docs });

function exportText(ids: string[], mutate?: (file: Record<string, unknown>) => void): string {
  const file = JSON.parse(serializeExport(buildExport(ids.map((id) => entry(id, [doc("overview")])), NOW))) as Record<string, unknown>;
  mutate?.(file);
  return JSON.stringify(file);
}

function expectImportError(fn: () => unknown, code: string): ImportError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ImportError);
    expect((err as ImportError).code).toBe(code);
    return err as ImportError;
  }
  throw new Error(`Expected ImportError ${code}`);
}

describe("export", () => {
  it("builds a versioned, self-describing document", () => {
    const file = buildExport([entry("a")], NOW);
    expect(file).toMatchObject({ format: EXPORT_FORMAT, schemaVersion: EXPORT_SCHEMA_VERSION, exportedAt: NOW.toISOString(), app: { name: "CodebaseXplorer" } });
    expect(file.projects[0]?.repository.files).toHaveLength(repo.files.length);
  });

  it("refuses to export invalid data", () => {
    expect(() => buildExport([{ meta: { ...meta("a"), id: "bad id" }, repository: repo, docs: [] }], NOW)).toThrow();
  });

  it("names files predictably", () => {
    expect(exportFileName([meta("a", "My App")], NOW)).toBe("codebasexplorer-my-app-2026-11-10.json");
    expect(exportFileName([meta("a"), meta("b")], NOW)).toBe("codebasexplorer-projects-2026-11-10.json");
  });
});

describe("import: parsing and validation", () => {
  it("round-trips a project without losing or adding anything", () => {
    const parsed = parseImport(exportText(["a"]), []);
    expect(parsed.fromVersion).toBe(1);
    expect(parsed.ignoredFields).toEqual([]);
    expect(parsed.warnings).toEqual([]);
    const { project } = parsed.candidates[0]!;
    expect(project.repository).toEqual(repo);
    expect(project.docs).toEqual([doc("overview")]);
    expect(project.meta.id).toBe("a");
  });

  it("recomputes derived statistics instead of trusting the file", () => {
    const text = exportText(["a"], (f) => {
      const p = (f.projects as { meta: Record<string, unknown> }[])[0]!;
      p.meta.fileCount = 99999;
      p.meta.sourceBytes = 1;
    });
    const meta0 = parseImport(text, []).candidates[0]!.project.meta;
    expect(meta0.fileCount).toBe(repo.files.length);
    expect(meta0.sourceBytes).toBeGreaterThan(1000);
  });

  it.each([
    ["not JSON at all", "this is not json", "not-json"],
    ["a truncated file", exportText(["a"]).slice(0, 500), "not-json"],
    ["a JSON array", "[]", "wrong-format"],
    ["another JSON document", JSON.stringify({ hello: "world" }), "wrong-format"],
    ["a wrong format marker", exportText(["a"], (f) => (f.format = "something-else")), "wrong-format"],
    ["a missing schema version", exportText(["a"], (f) => delete f.schemaVersion), "invalid"],
    ["a non-integer schema version", exportText(["a"], (f) => (f.schemaVersion = "1")), "invalid"],
    ["a zero schema version", exportText(["a"], (f) => (f.schemaVersion = 0)), "invalid"],
  ])("rejects %s", (_name, text, code) => {
    expectImportError(() => parseImport(text, []), code);
  });

  it("rejects files created by a newer version with a helpful message", () => {
    const err = expectImportError(() => parseImport(exportText(["a"], (f) => (f.schemaVersion = EXPORT_SCHEMA_VERSION + 1)), []), "newer-version");
    expect(err.message).toMatch(/newer version/);
    expect(err.message).toMatch(/Update the app/);
  });

  it("reports schema violations with the offending field paths", () => {
    const text = exportText(["a"], (f) => {
      const p = (f.projects as { repository: { files: Record<string, unknown>[]; analysis: Record<string, unknown> }; meta: Record<string, unknown> }[])[0]!;
      p.repository.files[0]!.language = "klingon";
      p.repository.analysis.status = "fine";
      p.meta.createdAt = "yesterday";
    });
    const err = expectImportError(() => parseImport(text, []), "invalid");
    expect(err.issues.length).toBeGreaterThan(0);
    expect(err.issues.join("\n")).toMatch(/projects\.0\./);
  });

  it.each([
    ["no projects", (f: Record<string, unknown>) => (f.projects = [])],
    ["a project with a missing repository", (f: Record<string, unknown>) => delete (f.projects as Record<string, unknown>[])[0]!.repository],
    ["an unsafe project id", (f: Record<string, unknown>) => ((f.projects as { meta: Record<string, unknown> }[])[0]!.meta.id = "../../etc")],
    ["an empty project name", (f: Record<string, unknown>) => ((f.projects as { meta: Record<string, unknown> }[])[0]!.meta.name = "  ")],
  ])("rejects %s", (_name, mutate) => {
    expectImportError(() => parseImport(exportText(["a"], mutate), []), "invalid");
  });

  it("rejects duplicate project ids inside one file", () => {
    const text = exportText(["a", "b"], (f) => ((f.projects as { meta: Record<string, unknown> }[])[1]!.meta.id = "a"));
    expectImportError(() => parseImport(text, []), "duplicate-ids");
  });

  it("rejects well-formed data that points at files that do not exist", () => {
    const text = exportText(["a"], (f) => {
      const r = (f.projects as { repository: { dependencies: Record<string, unknown>[]; files: { path: string }[] } }[])[0]!.repository;
      r.dependencies.push({ from: "src/ghost.ts", to: r.files[0]!.path, line: 1, specifier: "./x", typeOnly: false, kind: "import" });
    });
    const err = expectImportError(() => parseImport(text, []), "integrity");
    expect(err.issues.join(" ")).toMatch(/missing file/);
  });

  it("rejects unsafe file paths and inconsistent counts", () => {
    const issues = checkRepositoryIntegrity({ ...repo, files: [{ ...repo.files[0]!, path: "../escape.ts" }, ...repo.files.slice(1)] });
    expect(issues.join(" ")).toMatch(/Unsafe file path/);
    expect(checkRepositoryIntegrity({ ...repo, analysis: { ...repo.analysis, analyzedFiles: 1 } }).join(" ")).toMatch(/analyzed/);
    expect(checkRepositoryIntegrity(repo)).toEqual([]);
  });

  it("reports unknown fields instead of dropping them silently", () => {
    const text = exportText(["a"], (f) => {
      f.futureFeature = { x: 1 };
      (f.projects as Record<string, unknown>[])[0]!.tags = ["a"];
      ((f.projects as { meta: Record<string, unknown> }[])[0]!.meta).color = "red";
    });
    const parsed = parseImport(text, []);
    expect(parsed.ignoredFields).toEqual(expect.arrayContaining(["futureFeature", "projects[].tags", "projects[].meta.color"]));
    expect(parsed.warnings.join(" ")).toMatch(/do not|will not be imported/);
    expect(JSON.stringify(parsed.candidates)).not.toContain("futureFeature");
  });

  it("detects conflicts with saved projects", () => {
    const parsed = parseImport(exportText(["a", "b"]), [meta("b", "Saved B")]);
    expect(parsed.candidates.map((c) => [c.project.meta.id, c.existing?.name])).toEqual([["a", undefined], ["b", "Saved B"]]);
  });
});

describe("migrations", () => {
  const v1 = () => JSON.parse(exportText(["a"])) as Record<string, unknown>;
  const rename: Migration = (doc) => ({ ...doc, projects: doc.projects, app: doc.app });

  it("applies registered migrations in order up to the current version", () => {
    const calls: number[] = [];
    const migrations: Record<number, Migration> = {
      1: (d) => (calls.push(1), { ...d, migrated1: true }),
      2: (d) => (calls.push(2), { ...d, migrated2: true }),
    };
    const { data, fromVersion } = migrateExport(v1(), migrations, 3);
    expect(calls).toEqual([1, 2]);
    expect(fromVersion).toBe(1);
    expect(data).toMatchObject({ schemaVersion: 3, migrated1: true, migrated2: true });
  });

  it("rejects versions that have no migration path", () => {
    expectImportError(() => migrateExport(v1(), { 2: rename }, 3), "unsupported-version");
  });

  it("accepts the current version untouched and rejects newer ones", () => {
    expect(migrateExport(v1()).fromVersion).toBe(EXPORT_SCHEMA_VERSION);
    expectImportError(() => migrateExport({ ...v1(), schemaVersion: 7 }), "newer-version");
  });
});

describe("applying an import", () => {
  const imported = (ids: string[], existing: StoredProject["meta"][] = []) => parseImport(exportText(ids), existing);
  const seed = async (ids: string[], store: ProjectStore = new MemoryProjectStore()) => {
    for (const id of ids) await store.save({ meta: { ...meta(id), name: `Existing ${id}` }, repository: repo });
    return store;
  };
  const names = async (store: ProjectStore) => (await store.list()).projects.map((p) => p.name).sort();

  it("adds new projects together with their documentation", async () => {
    const store = new MemoryProjectStore();
    const report = await applyImport(store, imported(["a", "b"]), {}, NOW);
    expect(report.outcomes.map((o) => [o.id, o.result])).toEqual([["a", "added"], ["b", "added"]]);
    expect((await store.get("a"))?.repository.files).toHaveLength(repo.files.length);
    expect((await store.listDocs("b"))[0]?.markdown).toBe("# doc");
  });

  it("never overwrites a conflicting project unless told to (default = skip)", async () => {
    const store = await seed(["a"]);
    const report = await applyImport(store, imported(["a"], (await store.list()).projects), {}, NOW);
    expect(report.outcomes[0]).toMatchObject({ result: "skipped", message: expect.stringMatching(/Kept the existing/) });
    expect((await store.get("a"))?.meta.name).toBe("Existing a");
  });

  it("replaces on request, replacing documentation as well", async () => {
    const store = await seed(["a"]);
    await store.saveDoc("a", doc("api", "old api doc"));
    const report = await applyImport(store, imported(["a"], (await store.list()).projects), { a: "replace" }, NOW);
    expect(report.outcomes[0]?.result).toBe("replaced");
    expect((await store.get("a"))?.meta.name).toBe("a");
    expect((await store.listDocs("a")).map((d) => d.section)).toEqual(["overview"]); // old API doc was not part of the import
  });

  it("keeps both on request: the copy gets a new id and name, the original is untouched", async () => {
    const store = await seed(["a"]);
    const report = await applyImport(store, imported(["a"], (await store.list()).projects), { a: "copy" }, NOW);
    expect(report.outcomes[0]).toMatchObject({ result: "copied", newId: "a-copy" });
    expect(await names(store)).toEqual(["Existing a", "a (copy)"]);
    expect((await store.listDocs("a-copy"))[0]?.section).toBe("overview");
    expect((await store.get("a"))?.meta.name).toBe("Existing a");
  });

  it("generates distinct ids when importing the same copy twice", async () => {
    const store = await seed(["a"]);
    for (let i = 0; i < 2; i++) await applyImport(store, imported(["a"], (await store.list()).projects), { a: "copy" }, NOW);
    expect((await store.list()).projects.map((p) => p.id).sort()).toEqual(["a", "a-copy", "a-copy-2"]);
  });

  it("resolves each conflict independently and lets the user skip new projects too", async () => {
    const store = await seed(["a", "b"]);
    const resolutions: Record<string, Resolution> = { a: "replace", b: "skip", c: "skip" };
    const report = await applyImport(store, imported(["a", "b", "c"], (await store.list()).projects), resolutions, NOW);
    expect(report.outcomes.map((o) => o.result)).toEqual(["replaced", "skipped", "skipped"]);
    expect(await store.has("c")).toBe(false);
  });

  it("carries the parser warnings into the report", async () => {
    const text = exportText(["a"], (f) => (f.extra = true));
    const report = await applyImport(new MemoryProjectStore(), parseImport(text, []), {}, NOW);
    expect(report.warnings.join(" ")).toMatch(/extra/);
  });

  it("reports failures per project and stops when the storage is full, without losing existing data", async () => {
    const inner = new MemoryProjectStore();
    await seed(["keep"], inner);
    let saves = 0;
    const failing: ProjectStore = new Proxy(inner, {
      get(target, prop, receiver) {
        if (prop === "save") {
          return async (p: StoredProject) => {
            if (++saves === 2) throw new StorageError("quota", "The browser storage is full.");
            return target.save(p);
          };
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const report = await applyImport(failing, imported(["a", "b", "c"]), {}, NOW);
    expect(report.outcomes.map((o) => o.result)).toEqual(["added", "failed", "failed"]);
    expect(report.outcomes[1]?.message).toMatch(/storage is full/);
    expect(report.outcomes[2]?.message).toMatch(/Not imported/);
    expect(await inner.has("keep")).toBe(true);
    expect(await inner.has("a")).toBe(true);
  });

  it("keeps the existing project when a replacement fails", async () => {
    const inner = new MemoryProjectStore();
    await seed(["a"], inner);
    const failing = Object.create(inner, { save: { value: async () => Promise.reject(new StorageError("unknown", "boom")) } }) as ProjectStore;
    const report = await applyImport(failing, imported(["a"], (await inner.list()).projects), { a: "replace" }, NOW);
    expect(report.outcomes[0]?.result).toBe("failed");
    expect((await inner.get("a"))?.meta.name).toBe("Existing a");
  });
});

describe("findStrippedKeys", () => {
  it("finds nested unknown properties and ignores identical structures", () => {
    expect(findStrippedKeys({ a: 1, b: { c: 2, d: 3 }, e: [{ f: 1, g: 2 }] }, { a: 1, b: { c: 2 }, e: [{ f: 1 }] }).sort()).toEqual(["b.d", "e[].g"]);
    expect(findStrippedKeys({ a: [1, 2], b: "x" }, { a: [1, 2], b: "x" })).toEqual([]);
  });
});
