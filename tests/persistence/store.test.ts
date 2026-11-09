import "fake-indexeddb/auto"; // defines IDBKeyRange, IDBObjectStore... globals, as a browser would
import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StorageError, toStorageError } from "@/persistence/errors";
import { IndexedDbProjectStore } from "@/persistence/indexeddb";
import { MemoryProjectStore } from "@/persistence/memory";
import { metaFromRepository, newProjectId, slugify, uniqueCopyId, copyName } from "@/persistence/projects";
import { type StoredDoc, type AppSettings } from "@/persistence/schemas";
import type { ProjectStore } from "@/persistence/store";
import { DEFAULT_LIMITS } from "@/analysis/limits";
import { demoRepository as repo } from "@/mock/buildDemoRepo";

const NOW = new Date("2026-11-10T10:00:00.000Z");
const meta = (id: string, name = id, when = NOW) => metaFromRepository(repo, { id, name, origin: "zip", limits: DEFAULT_LIMITS, now: when });
const doc = (section: StoredDoc["section"], markdown = "# Docs"): StoredDoc => ({ section, markdown, provider: "mock", warnings: [], savedAt: NOW.toISOString() });
const settings: AppSettings = { limits: { ...DEFAULT_LIMITS, maxFiles: 123 }, autoSave: true, consentGiven: true };

type Factory = { name: string; create: () => Promise<ProjectStore> };
const factories: Factory[] = [
  { name: "MemoryProjectStore", create: async () => new MemoryProjectStore() },
  { name: "IndexedDbProjectStore", create: () => IndexedDbProjectStore.open("test-db", new IDBFactory()) },
];

describe.each(factories)("$name (shared contract)", ({ create }) => {
  let store: ProjectStore;
  const fresh = async () => {
    store = await create();
    return store;
  };
  afterEach(() => store?.close());

  it("starts empty", async () => {
    await fresh();
    expect(await store.list()).toEqual({ projects: [], damaged: [] });
    expect(await store.get("nope")).toBeNull();
    expect(await store.has("nope")).toBe(false);
    expect(await store.getSettings()).toBeNull();
  });

  it("saves and reads back a project with its full analysis and source", async () => {
    await fresh();
    await store.save({ meta: meta("acme-1"), repository: repo });
    const loaded = await store.get("acme-1");
    expect(loaded?.meta.id).toBe("acme-1");
    expect(loaded?.repository.files).toHaveLength(repo.files.length);
    expect(loaded?.repository.files[0]?.content).toBe(repo.files[0]?.content);
    expect(loaded?.repository.symbols).toEqual(repo.symbols);
    expect(await store.has("acme-1")).toBe(true);
  });

  it("lists lightweight metadata, most recently opened first", async () => {
    await fresh();
    await store.save({ meta: meta("a", "A", new Date("2026-01-01T00:00:00Z")), repository: repo });
    await store.save({ meta: meta("b", "B", new Date("2026-03-01T00:00:00Z")), repository: repo });
    await store.save({ meta: meta("c", "C", new Date("2026-02-01T00:00:00Z")), repository: repo });
    const { projects } = await store.list();
    expect(projects.map((p) => p.id)).toEqual(["b", "c", "a"]);
    expect(projects[0]).not.toHaveProperty("files"); // metadata only
  });

  it("overwrites a project with the same id", async () => {
    await fresh();
    await store.save({ meta: meta("x", "First"), repository: repo });
    await store.save({ meta: meta("x", "Second"), repository: repo });
    expect((await store.list()).projects).toHaveLength(1);
    expect((await store.get("x"))?.meta.name).toBe("Second");
  });

  it("updates metadata and rejects invalid updates", async () => {
    await fresh();
    await store.save({ meta: meta("x"), repository: repo });
    const updated = await store.updateMeta("x", { name: "Renamed", description: "Notes" });
    expect(updated).toMatchObject({ name: "Renamed", description: "Notes" });
    expect((await store.get("x"))?.meta.name).toBe("Renamed");
    await expect(store.updateMeta("x", { name: "   " })).rejects.toBeInstanceOf(StorageError);
    expect((await store.get("x"))?.meta.name).toBe("Renamed"); // unchanged after the failed update
    await expect(store.updateMeta("missing", { name: "x" })).rejects.toMatchObject({ code: "not-found" });
  });

  it("deletes a project together with its documentation, leaving others untouched", async () => {
    await fresh();
    await store.save({ meta: meta("a"), repository: repo });
    await store.save({ meta: meta("b"), repository: repo });
    await store.saveDoc("a", doc("overview"));
    await store.saveDoc("b", doc("overview", "# B"));
    await store.delete("a");
    expect(await store.get("a")).toBeNull();
    expect(await store.listDocs("a")).toEqual([]);
    expect((await store.listDocs("b"))[0]?.markdown).toBe("# B");
    await expect(store.delete("a")).resolves.toBeUndefined(); // idempotent
  });

  it("stores documentation per project and section", async () => {
    await fresh();
    await store.save({ meta: meta("a"), repository: repo });
    await store.saveDoc("a", doc("overview", "one"));
    await store.saveDoc("a", doc("api", "two"));
    await store.saveDoc("a", doc("overview", "one v2"));
    expect((await store.listDocs("a")).map((d) => [d.section, d.markdown]).sort()).toEqual([["api", "two"], ["overview", "one v2"]]);
    await store.deleteDoc("a", "api");
    expect((await store.listDocs("a")).map((d) => d.section)).toEqual(["overview"]);
    await expect(store.saveDoc("ghost", doc("overview"))).rejects.toMatchObject({ code: "not-found" });
  });

  it("persists settings", async () => {
    await fresh();
    await store.saveSettings(settings);
    expect(await store.getSettings()).toEqual(settings);
    await expect(store.saveSettings({ ...settings, limits: { ...settings.limits, maxFiles: -5 } })).rejects.toBeInstanceOf(StorageError);
    expect(await store.getSettings()).toEqual(settings);
  });

  it("refuses to store invalid data and stores nothing", async () => {
    await fresh();
    const bad = { ...repo, files: [{ ...repo.files[0], language: "klingon" }] } as unknown as typeof repo;
    await expect(store.save({ meta: meta("bad"), repository: bad })).rejects.toBeInstanceOf(StorageError);
    await expect(store.save({ meta: { ...meta("bad"), id: "has spaces" }, repository: repo })).rejects.toBeInstanceOf(StorageError);
    expect(await store.has("bad")).toBe(false);
  });

  it("clears everything", async () => {
    await fresh();
    await store.save({ meta: meta("a"), repository: repo });
    await store.saveDoc("a", doc("overview"));
    await store.saveSettings(settings);
    await store.clearAll();
    expect(await store.list()).toEqual({ projects: [], damaged: [] });
    expect(await store.listDocs("a")).toEqual([]);
    expect(await store.getSettings()).toBeNull();
  });

  it("returns copies: mutating a loaded project does not change what is stored", async () => {
    await fresh();
    await store.save({ meta: meta("a"), repository: repo });
    const first = await store.get("a");
    if (first) first.repository.files[0]!.content = "tampered";
    expect((await store.get("a"))?.repository.files[0]?.content).toBe(repo.files[0]?.content);
  });
});

describe("IndexedDbProjectStore specifics", () => {
  it("survives closing and reopening the database (real persistence)", async () => {
    const factory = new IDBFactory();
    const first = await IndexedDbProjectStore.open("persist", factory);
    await first.save({ meta: meta("kept", "Kept"), repository: repo });
    await first.saveDoc("kept", doc("overview", "# persisted"));
    first.close();
    const second = await IndexedDbProjectStore.open("persist", factory);
    expect((await second.list()).projects.map((p) => p.name)).toEqual(["Kept"]);
    expect((await second.listDocs("kept"))[0]?.markdown).toBe("# persisted");
    expect((await second.get("kept"))?.repository.symbols).toHaveLength(repo.symbols.length);
    second.close();
  });

  it("reports damaged records instead of hiding them or crashing the list", async () => {
    const factory = new IDBFactory();
    const store = await IndexedDbProjectStore.open("damaged", factory);
    await store.save({ meta: meta("good"), repository: repo });
    // Corrupt data written behind the store's back (e.g. by another version of the app).
    const raw = await new Promise<IDBDatabase>((resolve) => {
      const r = factory.open("damaged", 1);
      r.onsuccess = () => resolve(r.result);
    });
    await new Promise<void>((resolve) => {
      const tx = raw.transaction(["projects", "repositories"], "readwrite");
      tx.objectStore("projects").put({ id: "broken", name: 42 });
      tx.objectStore("projects").put({ ...meta("norepo"), id: "norepo" });
      tx.oncomplete = () => resolve();
    });
    const { projects, damaged } = await store.list();
    expect(projects.map((p) => p.id).sort()).toEqual(["good", "norepo"]);
    expect(damaged).toEqual(["broken"]);
    await expect(store.get("broken")).rejects.toMatchObject({ code: "corrupted" });
    await expect(store.get("norepo")).rejects.toMatchObject({ code: "corrupted", message: expect.stringMatching(/missing/) });
    expect(await store.get("good")).not.toBeNull();
    raw.close();
    store.close();
  });

  it("writes metadata and analysis atomically: a failed write leaves nothing behind", async () => {
    const store = await IndexedDbProjectStore.open("atomic", new IDBFactory());
    const failing = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => {
      throw new DOMException("disk full", "QuotaExceededError");
    });
    await expect(store.save({ meta: meta("big"), repository: repo })).rejects.toMatchObject({ code: "quota", message: expect.stringMatching(/storage is full/) });
    failing.mockRestore();
    expect(await store.has("big")).toBe(false);
    expect(await store.get("big")).toBeNull();
    store.close();
  });

  it("reports unavailable storage clearly", async () => {
    await expect(IndexedDbProjectStore.open("x", null)).rejects.toMatchObject({ code: "unavailable" });
  });
});

describe("storage errors", () => {
  it("maps browser errors to user-presentable messages", () => {
    expect(toStorageError(new DOMException("x", "QuotaExceededError")).code).toBe("quota");
    expect(toStorageError(new DOMException("x", "SecurityError")).code).toBe("unavailable");
    expect(toStorageError(new DOMException("x", "DataCloneError")).code).toBe("unknown");
    expect(toStorageError(new Error("boom")).message).not.toContain("boom");
  });
});

describe("project helpers", () => {
  it("builds metadata from a repository", () => {
    const m = metaFromRepository(repo, { id: "p1", origin: "folder", limits: DEFAULT_LIMITS, now: NOW });
    expect(m).toMatchObject({ id: "p1", name: "acme-shop-api", origin: "folder", fileCount: repo.files.length, parsedFileCount: 24, createdAt: NOW.toISOString() });
    expect(m.sourceBytes).toBe(repo.files.reduce((s, f) => s + f.size, 0));
    expect(m.languages[0]).toBe("typescript");
  });

  it("creates readable unique ids and copy names", () => {
    expect(slugify("My Cool App!")).toBe("my-cool-app");
    expect(slugify("???")).toBe("project");
    expect(newProjectId("My App", () => "abcd1234")).toBe("my-app-abcd1234");
    expect(newProjectId("x")).not.toBe(newProjectId("x"));
    expect(uniqueCopyId("a", new Set(["a"]))).toBe("a-copy");
    expect(uniqueCopyId("a", new Set(["a", "a-copy"]))).toBe("a-copy-2");
    expect(uniqueCopyId("a-copy", new Set(["a", "a-copy"]))).toBe("a-copy-2");
    expect(copyName("App", new Set(["App", "App (copy)"]))).toBe("App (copy 2)");
  });
});
