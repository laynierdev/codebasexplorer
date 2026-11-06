import { describe, expect, it } from "vitest";
import { countLines, decodeText, kindOf, languageOf, looksBinary } from "@/analysis/classify";
import { IgnoreRules, ScanPlanner } from "@/analysis/ignore";
import { classifyLayer } from "@/analysis/layers";
import { resolveLimits } from "@/analysis/limits";
import { ImportResolver } from "@/analysis/resolve";

describe("language and kind detection", () => {
  it.each([
    ["a.ts", "typescript"], ["a.tsx", "typescript"], ["a.d.ts", "typescript"], ["a.mjs", "javascript"], ["a.jsx", "javascript"],
    ["x/y.py", "python"], ["main.go", "go"], ["README.md", "markdown"], ["Dockerfile", "shell"], ["style.scss", "css"],
    ["unknown.xyz", "text"], ["noext", "text"],
  ])("languageOf(%s) = %s", (path, language) => {
    expect(languageOf(path)).toBe(language);
  });

  it("classifies kinds", () => {
    expect(kindOf("src/a.test.ts", "typescript")).toBe("test");
    expect(kindOf("tests/x.ts", "typescript")).toBe("test");
    expect(kindOf("package.json", "json")).toBe("config");
    expect(kindOf(".env.example", "text")).toBe("config");
    expect(kindOf("README.md", "markdown")).toBe("doc");
    expect(kindOf("scripts/run.sh", "shell")).toBe("script");
    expect(kindOf("src/a.ts", "typescript")).toBe("source");
  });
});

describe("binary and text detection", () => {
  it("detects NUL bytes as binary", () => {
    expect(looksBinary(new Uint8Array([1, 2, 0, 3]))).toBe(true);
  });
  it("treats normal text as text", () => {
    expect(looksBinary(new TextEncoder().encode("hello\nworld\ttab\r\n"))).toBe(false);
    expect(looksBinary(new Uint8Array(0))).toBe(false);
  });
  it("decodes UTF-8 and strips a BOM", () => {
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x68, 0x69]))).toBe("hi");
    expect(decodeText(new TextEncoder().encode("héllo ✓"))).toBe("héllo ✓");
  });
  it("falls back to Windows-1252 for legacy encodings", () => {
    expect(decodeText(new Uint8Array([0x63, 0x61, 0x66, 0xe9]))).toBe("café");
  });
  it("counts lines like an editor", () => {
    expect(countLines("")).toBe(0);
    expect(countLines("a")).toBe(1);
    expect(countLines("a\n")).toBe(1);
    expect(countLines("a\nb\n")).toBe(2);
    expect(countLines("a\n\n")).toBe(2);
  });
});

describe("IgnoreRules", () => {
  const limits = resolveLimits();

  it("ignores default directories at any depth", () => {
    const rules = new IgnoreRules(limits);
    expect(rules.check("node_modules/x/index.js")).toMatchObject({ reason: "ignored-directory", groupPath: "node_modules/" });
    expect(rules.check("packages/a/node_modules/x.js")).toMatchObject({ groupPath: "packages/a/node_modules/" });
    expect(rules.check(".git/config")).not.toBeNull();
    expect(rules.check("dist/bundle.js")).not.toBeNull();
    expect(rules.check("src/distance.ts")).toBeNull();
    expect(rules.check("src/build.ts")).toBeNull();
  });

  it("ignores lock files and minified assets but not similarly named sources", () => {
    const rules = new IgnoreRules(limits);
    expect(rules.check("package-lock.json")).toMatchObject({ reason: "ignored-pattern" });
    expect(rules.check("public/app.min.js")).not.toBeNull();
    expect(rules.check("src/app.js")).toBeNull();
  });

  it("applies extra patterns and nested .gitignore files", () => {
    const rules = new IgnoreRules(
      resolveLimits({ extraIgnores: ["fixtures/"] }),
      new Map([["", "*.tmp\n!keep.tmp\n"], ["pkg", "private/\n"]]),
    );
    expect(rules.check("fixtures/a.ts")).toMatchObject({ reason: "ignored-pattern" });
    expect(rules.check("a.tmp")).toMatchObject({ reason: "gitignore" });
    expect(rules.check("keep.tmp")).toBeNull();
    expect(rules.check("pkg/private/x.ts")).toMatchObject({ reason: "gitignore", groupPath: "pkg/private/" });
    expect(rules.check("other/private/x.ts")).toBeNull();
  });
});

describe("ScanPlanner", () => {
  it("aggregates skipped items by group and keeps counts", () => {
    const limits = resolveLimits({ maxFileBytes: 100 });
    const planner = new ScanPlanner(limits, new IgnoreRules(limits));
    expect(planner.decide("src/a.ts", 10).include).toBe(true);
    for (let i = 0; i < 5; i++) planner.decide(`node_modules/p/f${i}.js`, 10);
    planner.decide("src/huge.ts", 5000);
    planner.decide("img/logo.png", 10);
    const skipped = planner.skipped();
    expect(skipped.find((s) => s.path === "node_modules/")?.fileCount).toBe(5);
    expect(skipped.find((s) => s.path === "src/huge.ts")?.reason).toBe("too-large");
    expect(skipped.find((s) => s.path === "img/logo.png")?.reason).toBe("binary");
  });
});

describe("classifyLayer", () => {
  it.each([
    ["src/routes/a.routes.ts", "route"], ["src/controllers/x.ts", "controller"], ["src/services/x.ts", "service"], ["src/repositories/x.ts", "repository"],
    ["src/db/client.ts", "database"], ["src/middleware/x.ts", "middleware"], ["src/config/env.ts", "config"], ["src/models/types.ts", "model"],
    ["src/server.ts", "entry"], ["src/app.ts", "entry"], ["tests/a.test.ts", "test"], ["src/foo.spec.ts", "test"],
    ["app/api/users/route.ts", "route"], ["app/dashboard/page.tsx", "page"], ["src/components/Button.tsx", "component"],
    ["src/user.controller.ts", "controller"], ["src/misc/thing.ts", "other"],
  ])("%s → %s", (path, layer) => {
    expect(classifyLayer(path)).toBe(layer);
  });
});

describe("ImportResolver", () => {
  const files = new Set(["src/a.ts", "src/b.tsx", "src/lib/index.ts", "src/util.js", "src/types.d.ts", "src/data.json", "lib/x.ts", "components/Card.tsx"]);

  it("resolves relative imports with extension and index fallbacks", () => {
    const r = new ImportResolver({ files });
    expect(r.resolve("src/main.ts", "./a")).toEqual({ kind: "file", path: "src/a.ts" });
    expect(r.resolve("src/main.ts", "./b")).toEqual({ kind: "file", path: "src/b.tsx" });
    expect(r.resolve("src/main.ts", "./lib")).toEqual({ kind: "file", path: "src/lib/index.ts" });
    expect(r.resolve("src/main.ts", "./data.json")).toEqual({ kind: "file", path: "src/data.json" });
    expect(r.resolve("src/deep/x.ts", "../a")).toEqual({ kind: "file", path: "src/a.ts" });
  });

  it("maps .js specifiers to .ts sources (ESM style)", () => {
    const r = new ImportResolver({ files });
    expect(r.resolve("src/main.ts", "./a.js")).toEqual({ kind: "file", path: "src/a.ts" });
    expect(r.resolve("src/main.ts", "./util.js")).toEqual({ kind: "file", path: "src/util.js" });
  });

  it("reports unresolved relative imports", () => {
    expect(new ImportResolver({ files }).resolve("src/main.ts", "./missing")).toEqual({ kind: "unresolved", specifier: "./missing" });
  });

  it("classifies packages and Node builtins", () => {
    const r = new ImportResolver({ files });
    expect(r.resolve("src/a.ts", "express")).toEqual({ kind: "external", name: "express" });
    expect(r.resolve("src/a.ts", "@scope/pkg/deep")).toEqual({ kind: "external", name: "@scope/pkg" });
    expect(r.resolve("src/a.ts", "lodash/fp")).toEqual({ kind: "external", name: "lodash" });
    expect(r.resolve("src/a.ts", "fs")).toEqual({ kind: "builtin", name: "fs" });
    expect(r.resolve("src/a.ts", "node:path")).toEqual({ kind: "builtin", name: "path" });
  });

  it("resolves tsconfig paths and baseUrl (JSONC tolerated)", () => {
    const tsconfigText = `{
      // comment
      "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["src/*"], "@ui": ["components/Card.tsx"] }, },
    }`;
    const r = new ImportResolver({ files, tsconfigText });
    expect(r.resolve("src/main.ts", "@/a")).toEqual({ kind: "file", path: "src/a.ts" });
    expect(r.resolve("src/main.ts", "@ui")).toEqual({ kind: "file", path: "components/Card.tsx" });
    expect(r.resolve("src/main.ts", "lib/x")).toEqual({ kind: "file", path: "lib/x.ts" });
  });

  it("does not crash on malformed tsconfig", () => {
    const r = new ImportResolver({ files, tsconfigText: "{ not json" });
    expect(r.resolve("src/main.ts", "./a")).toEqual({ kind: "file", path: "src/a.ts" });
  });
});
