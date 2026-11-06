import { describe, expect, it } from "vitest";
import { typescriptParser } from "@/analysis/parsers/typescript";

const parse = (code: string, path = "src/file.ts") => typescriptParser.parse(path, code);

describe("typescript parser: symbols", () => {
  it("extracts functions, classes, interfaces, types, enums and consts with line ranges", () => {
    const code = [
      "export function a() {", // 1
      "  return 1;", // 2
      "}", // 3
      "class B {}", // 4
      "export interface C { x: number }", // 5
      "export type D = string;", // 6
      "export enum E { One }", // 7
      "export const F = 1;", // 8
    ].join("\n");
    const { symbols } = parse(code);
    expect(symbols.map((s) => [s.name, s.kind, s.exported, s.startLine, s.endLine])).toEqual([
      ["a", "function", true, 1, 3],
      ["B", "class", false, 4, 4],
      ["C", "interface", true, 5, 5],
      ["D", "type", true, 6, 6],
      ["E", "enum", true, 7, 7],
      ["F", "const", true, 8, 8],
    ]);
  });

  it("treats arrow functions assigned to consts as functions", () => {
    const { symbols } = parse("export const handler = async (req) => {\n  await save(req);\n};\n");
    expect(symbols[0]).toMatchObject({ name: "handler", kind: "function", exported: true, startLine: 1, endLine: 3 });
    expect(symbols[0]?.calls).toContain("save");
  });

  it("marks names exported later via export { }", () => {
    const { symbols } = parse("function a() {}\nfunction b() {}\nexport { a };\n");
    expect(symbols.find((s) => s.name === "a")?.exported).toBe(true);
    expect(symbols.find((s) => s.name === "b")?.exported).toBe(false);
  });

  it("names default exports", () => {
    const { symbols } = parse("export default function () {}\n");
    expect(symbols[0]).toMatchObject({ name: "default", kind: "function", exported: true });
  });

  it("records calls, including member calls and constructors", () => {
    const { symbols } = parse("function f() {\n  helper();\n  db.users.find();\n  new Thing();\n}\n");
    expect(symbols[0]?.calls).toEqual(expect.arrayContaining(["helper", "db.users.find", "Thing"]));
  });

  it("handles TSX and JSX", () => {
    const { symbols, issues } = parse("export function App() { return <div className='x'>hi</div>; }\n", "src/App.tsx");
    expect(issues).toBe(0);
    expect(symbols[0]?.name).toBe("App");
  });

  it("parses plain JavaScript", () => {
    const { symbols, imports } = parse("const x = require('./x');\nfunction y() {}\nmodule.exports = { y };\n", "lib/y.js");
    expect(symbols.map((s) => s.name)).toEqual(["x", "y"]);
    expect(imports[0]).toMatchObject({ specifier: "./x", kind: "require" });
  });
});

describe("typescript parser: imports", () => {
  it("captures static imports with bindings", () => {
    const { imports } = parse("import def, { a, b as c } from './m';\nimport * as ns from '../n';\nimport './side';\n");
    expect(imports).toHaveLength(3);
    expect(imports[0]).toMatchObject({ specifier: "./m", kind: "import", typeOnly: false, line: 1 });
    expect(imports[0]?.bindings).toEqual([
      { local: "def", imported: "default" },
      { local: "a", imported: "a" },
      { local: "c", imported: "b" },
    ]);
    expect(imports[1]?.bindings).toEqual([{ local: "ns", imported: "*" }]);
    expect(imports[2]?.bindings).toEqual([]);
  });

  it("detects type-only imports", () => {
    const { imports } = parse("import type { A } from './a';\nimport { type B } from './b';\nimport { c, type D } from './c';\n");
    expect(imports.map((i) => i.typeOnly)).toEqual([true, true, false]);
  });

  it("captures re-exports, require and dynamic import", () => {
    const code = "export * from './all';\nexport { x } from './x';\nconst { a, b: renamed } = require('./cjs');\nconst lazy = () => import('./lazy');\nimport fs = require('fs');\n";
    const { imports } = parse(code);
    expect(imports.map((i) => [i.specifier, i.kind])).toEqual([
      ["./all", "export"],
      ["./x", "export"],
      ["fs", "require"],
      ["./cjs", "require"],
      ["./lazy", "dynamic"],
    ]);
    expect(imports.find((i) => i.specifier === "./cjs")?.bindings).toEqual([
      { local: "a", imported: "a" },
      { local: "renamed", imported: "b" },
    ]);
  });

  it("treats vi.mock / jest.mock of a module as a dependency of the test", () => {
    const { imports } = parse("vi.mock('../src/db');\njest.mock('./x');\nvi.fn('./not-a-module');\n", "tests/a.test.ts");
    expect(imports.map((i) => [i.specifier, i.kind])).toEqual([["../src/db", "mock"], ["./x", "mock"]]);
  });

  it("ignores non-literal require/import arguments", () => {
    const { imports } = parse("const m = require(name);\nimport(path);\n");
    expect(imports).toHaveLength(0);
  });
});

describe("typescript parser: routes", () => {
  it("detects Express routes and mounts", () => {
    const code = [
      "import { Router } from 'express';",
      "export const usersRouter = Router();",
      "usersRouter.get('/', list);",
      "usersRouter.post('/:id', requireAuth, ctrl.create);",
      "usersRouter.use(requireAuth);",
      "app.use('/api/users', usersRouter);",
    ].join("\n");
    const { routes, mounts } = parse(code);
    expect(routes).toEqual([
      { routerName: "usersRouter", method: "GET", path: "/", line: 3, handler: "list" },
      { routerName: "usersRouter", method: "POST", path: "/:id", line: 4, handler: "ctrl.create" },
    ]);
    expect(mounts).toEqual([{ parent: "app", prefix: "/api/users", routerName: "usersRouter" }]);
  });

  it("marks inline handlers", () => {
    const { routes } = parse("app.get('/health', (req, res) => res.send('ok'));\n");
    expect(routes[0]).toMatchObject({ method: "GET", path: "/health", handler: "(inline)" });
  });

  it("does not mistake HTTP client calls for routes", () => {
    const { routes } = parse("import axios from 'axios';\naxios.get('/users', { params: {} });\nclient.post('/x', body);\n");
    expect(routes).toHaveLength(0);
  });
});

describe("typescript parser: robustness", () => {
  it("is tolerant of syntax errors and reports them", () => {
    const { symbols, issues } = parse("export function ok() {}\nexport function broken( {\n");
    expect(issues).toBeGreaterThan(0);
    expect(symbols.some((s) => s.name === "ok")).toBe(true);
  });

  it("handles an empty file", () => {
    expect(parse("")).toMatchObject({ symbols: [], imports: [], routes: [], issues: 0 });
  });

  it("never executes code in the file", () => {
    const g = globalThis as unknown as { __pwned?: boolean };
    parse("globalThis.__pwned = true;\nprocess.exit(1);\n");
    expect(g.__pwned).toBeUndefined();
  });
});
