import { describe, expect, it } from "vitest";
import { resolveLimits, ArchiveError } from "@/analysis/limits";
import { extractZip, sanitizeEntryPath } from "@/analysis/zip";
import { makeZip } from "../helpers";

const limits = resolveLimits();

function expectArchiveError(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ArchiveError);
    expect((err as ArchiveError).code).toBe(code);
    return;
  }
  throw new Error(`Expected ArchiveError ${code} but nothing was thrown`);
}

describe("sanitizeEntryPath", () => {
  it("normalizes separators and dots", () => {
    expect(sanitizeEntryPath("src\\app.ts", limits)).toBe("src/app.ts");
    expect(sanitizeEntryPath("./src/./app.ts", limits)).toBe("src/app.ts");
  });

  it("returns null for directories", () => {
    expect(sanitizeEntryPath("src/", limits)).toBeNull();
  });

  it.each(["../evil.ts", "src/../../evil.ts", "a/b/../../../c", "..\\evil.ts"])("rejects traversal %s", (name) => {
    expectArchiveError(() => sanitizeEntryPath(name, limits), "unsafe-path");
  });

  it.each(["/etc/passwd", "C:\\Windows\\x.dll", "c:/x"])("rejects absolute path %s", (name) => {
    expectArchiveError(() => sanitizeEntryPath(name, limits), "unsafe-path");
  });

  it("rejects control characters and NUL bytes", () => {
    expectArchiveError(() => sanitizeEntryPath("a\u0000b.ts", limits), "unsafe-path");
  });

  it("enforces path length and depth", () => {
    expectArchiveError(() => sanitizeEntryPath("a/".repeat(300) + "x.ts", limits), "path-too-long");
    expectArchiveError(() => sanitizeEntryPath("a/".repeat(50) + "x.ts", resolveLimits({ maxPathDepth: 10 })), "path-too-deep");
  });
});

describe("extractZip", () => {
  it("extracts files and strips a single top-level folder", () => {
    const zip = makeZip({ "proj-main/src/a.ts": "export const a = 1;\n", "proj-main/README.md": "# hi\n" });
    const result = extractZip(zip, limits);
    expect(result.entries.map((e) => e.path).sort()).toEqual(["README.md", "src/a.ts"]);
  });

  it("keeps paths unchanged when there is no single root folder", () => {
    const zip = makeZip({ "src/a.ts": "1", "README.md": "2" });
    expect(extractZip(zip, limits).entries.map((e) => e.path).sort()).toEqual(["README.md", "src/a.ts"]);
  });

  it("never inflates ignored directories and reports them", () => {
    const zip = makeZip({
      "src/a.ts": "export const a = 1;\n",
      "node_modules/left-pad/index.js": "module.exports = 1;",
      "node_modules/left-pad/package.json": "{}",
      ".git/HEAD": "ref: refs/heads/main",
    });
    const result = extractZip(zip, limits);
    expect(result.entries.map((e) => e.path)).toEqual(["src/a.ts"]);
    const nm = result.skipped.find((s) => s.path === "node_modules/");
    expect(nm).toMatchObject({ reason: "ignored-directory", fileCount: 2 });
    expect(result.skipped.find((s) => s.path === ".git/")).toBeDefined();
  });

  it("respects the root .gitignore", () => {
    const zip = makeZip({ ".gitignore": "generated/\n*.secret\n", "src/a.ts": "1", "generated/x.ts": "2", "src/key.secret": "3" });
    const result = extractZip(zip, limits);
    expect(result.entries.map((e) => e.path).sort()).toEqual([".gitignore", "src/a.ts"]);
    expect(result.skipped.every((s) => s.reason === "gitignore")).toBe(true);
  });

  it("can disable .gitignore handling", () => {
    const zip = makeZip({ ".gitignore": "generated/\n", "generated/x.ts": "2" });
    const result = extractZip(zip, resolveLimits({ respectGitignore: false }));
    expect(result.entries.map((e) => e.path)).toContain("generated/x.ts");
  });

  it("reports files over the per-file limit without inflating them", () => {
    const zip = makeZip({ "README.md": "hi", "src/small.ts": "1", "src/big.ts": "x".repeat(5000) });
    const result = extractZip(zip, resolveLimits({ maxFileBytes: 1000 }));
    expect(result.entries.map((e) => e.path).sort()).toEqual(["README.md", "src/small.ts"]);
    expect(result.skipped).toContainEqual(expect.objectContaining({ path: "src/big.ts", reason: "too-large" }));
  });

  it("skips known binary extensions", () => {
    const zip = makeZip({ "a.ts": "1", "logo.png": new Uint8Array([137, 80, 78, 71]) });
    const result = extractZip(zip, limits);
    expect(result.entries.map((e) => e.path)).toEqual(["a.ts"]);
    expect(result.skipped).toContainEqual(expect.objectContaining({ path: "logo.png", reason: "binary" }));
  });

  it("stops analyzing after maxFiles and reports the rest", () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 10; i++) files[`f${i}.ts`] = "1";
    const result = extractZip(makeZip(files), resolveLimits({ maxFiles: 4 }));
    expect(result.entries).toHaveLength(4);
    expect(result.skipped.filter((s) => s.reason === "over-file-limit")).toHaveLength(6);
  });

  it("rejects the whole archive on path traversal", () => {
    expectArchiveError(() => extractZip(makeZip({ "ok.ts": "1", "../../evil.sh": "rm -rf /" }), limits), "unsafe-path");
  });

  it("rejects absolute paths", () => {
    expectArchiveError(() => extractZip(makeZip({ "/etc/cron.d/x": "1" }), limits), "unsafe-path");
  });

  it("rejects duplicate entries differing only by case", () => {
    expectArchiveError(() => extractZip(makeZip({ "a/File.ts": "1", "a/file.ts": "2" }), limits), "duplicate-path");
  });

  it("rejects archives with too many entries", () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 20; i++) files[`f${i}.ts`] = "1";
    expectArchiveError(() => extractZip(makeZip(files), resolveLimits({ maxEntries: 10 })), "too-many-entries");
  });

  it("rejects oversized archives", () => {
    const zip = makeZip({ "a.ts": "x".repeat(2000) }, 0);
    expectArchiveError(() => extractZip(zip, resolveLimits({ maxArchiveBytes: 500 })), "archive-too-large");
  });

  it("rejects archives whose analyzable content expands beyond the total limit", () => {
    const zip = makeZip({ "a.ts": "x".repeat(4000), "b.ts": "y".repeat(4000) });
    expectArchiveError(() => extractZip(zip, resolveLimits({ maxTotalBytes: 5000 })), "uncompressed-too-large");
  });

  it("rejects a suspicious compression ratio (zip bomb)", () => {
    const bomb = new Uint8Array(6 * 1024 * 1024); // 6 MB of zeros compresses to a few KB
    const zip = makeZip({ "bomb.txt": bomb });
    expectArchiveError(() => extractZip(zip, resolveLimits({ maxFileBytes: 10 * 1024 * 1024 })), "compression-ratio");
  });

  it("does not inflate a bomb hidden inside an ignored directory", () => {
    const bomb = new Uint8Array(50 * 1024 * 1024);
    const zip = makeZip({ "src/a.ts": "1", "node_modules/bomb/data.js": bomb });
    const started = Date.now();
    const result = extractZip(zip, limits);
    expect(result.entries.map((e) => e.path)).toEqual(["src/a.ts"]);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  function withDeclaredSize(zip: Uint8Array, size: number): Uint8Array {
    const copy = zip.slice();
    const view = new DataView(copy.buffer);
    // Local header uncompressed size is at offset 22, central directory entry at offset 24.
    for (let i = 0; i < copy.length - 4; i++) {
      if (view.getUint32(i, true) === 0x04034b50) view.setUint32(i + 22, size, true);
      if (view.getUint32(i, true) === 0x02014b50) view.setUint32(i + 24, size, true);
    }
    return copy;
  }

  it("never produces more data than the (understated) declared size", () => {
    const zip = withDeclaredSize(makeZip({ "a.ts": "x".repeat(4000) }), 50);
    let produced = -1;
    try {
      produced = extractZip(zip, limits).entries[0]?.data.byteLength ?? 0;
    } catch (err) {
      expect(err).toBeInstanceOf(ArchiveError);
      return;
    }
    // Memory stays bounded by the declared size: the inflater cannot be tricked into allocating more.
    expect(produced).toBeLessThanOrEqual(50);
  });

  it("detects a header that overstates the uncompressed size", () => {
    const zip = withDeclaredSize(makeZip({ "a.ts": "x".repeat(4000) }), 9000);
    let thrown: unknown;
    try {
      extractZip(zip, limits);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ArchiveError);
    expect(["size-mismatch", "not-a-zip"]).toContain((thrown as ArchiveError).code);
  });

  it("rejects files that are not ZIP archives", () => {
    expectArchiveError(() => extractZip(new TextEncoder().encode("not a zip at all"), limits), "not-a-zip");
    expectArchiveError(() => extractZip(new Uint8Array(0), limits), "empty");
  });

  it("rejects truncated or corrupt archives with a clear error", () => {
    const zip = makeZip({ "a.ts": "hello world".repeat(100) });
    expectArchiveError(() => extractZip(zip.slice(0, Math.floor(zip.length / 2)), limits), "not-a-zip");
  });
});
