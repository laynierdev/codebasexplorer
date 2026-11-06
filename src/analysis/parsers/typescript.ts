import ts from "typescript";
import type { ImportBinding, LanguageParser, ParsedImport, ParsedMount, ParsedRoute, ParsedSymbol, ParseResult } from "./types";

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "all", "head", "options"]);
const ROUTER_FACTORIES = new Set(["Router", "express", "fastify", "Fastify", "Hono", "Elysia", "Koa"]);
const ROUTER_NAMES = new Set(["app", "router", "server", "api"]);
const MAX_CALLS_PER_SYMBOL = 60;

function scriptKind(path: string): ts.ScriptKind {
  if (path.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (path.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (/\.(js|mjs|cjs)$/.test(path)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/**
 * Parser for TypeScript and JavaScript using the TypeScript compiler API (syntax only: no type checking,
 * no module resolution, no code execution). Tolerant of syntax errors.
 */
export const typescriptParser: LanguageParser = {
  id: "typescript",
  languages: ["typescript", "javascript"],
  parse(path, content) {
    const sf = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, scriptKind(path));
    return extract(sf);
  },
};

function line(sf: ts.SourceFile, pos: number): number {
  return sf.getLineAndCharacterOfPosition(pos).line + 1;
}

function hasExport(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false);
}

function hasDefault(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) ?? false);
}

function stringValue(node: ts.Node | undefined): string | undefined {
  if (!node) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return undefined;
}

/** `a`, `a.b`, `a.b.c` for identifiers and property-access chains; undefined for anything else. */
function dottedName(expr: ts.Expression): string | undefined {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) {
    const left = dottedName(expr.expression);
    return left ? `${left}.${expr.name.text}` : undefined;
  }
  return undefined;
}

function collectCalls(node: ts.Node): string[] {
  const calls = new Set<string>();
  const visit = (n: ts.Node) => {
    if (calls.size >= MAX_CALLS_PER_SYMBOL) return;
    if (ts.isCallExpression(n)) {
      const name = dottedName(n.expression);
      if (name && name !== "require") calls.add(name);
    } else if (ts.isNewExpression(n)) {
      const name = dottedName(n.expression);
      if (name) calls.add(name);
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return [...calls];
}

function importBindings(clause: ts.ImportClause | undefined): { bindings: ImportBinding[]; typeOnly: boolean } {
  if (!clause) return { bindings: [], typeOnly: false };
  const bindings: ImportBinding[] = [];
  if (clause.name) bindings.push({ local: clause.name.text, imported: "default" });
  const named = clause.namedBindings;
  let allTypeOnly = clause.isTypeOnly;
  if (named && ts.isNamespaceImport(named)) bindings.push({ local: named.name.text, imported: "*" });
  if (named && ts.isNamedImports(named)) {
    for (const el of named.elements) bindings.push({ local: el.name.text, imported: (el.propertyName ?? el.name).text });
    if (!allTypeOnly && named.elements.length > 0 && !clause.name) allTypeOnly = named.elements.every((e) => e.isTypeOnly);
  }
  return { bindings, typeOnly: allTypeOnly };
}

function extract(sf: ts.SourceFile): ParseResult {
  const symbols: ParsedSymbol[] = [];
  const imports: ParsedImport[] = [];
  const routes: ParsedRoute[] = [];
  const mounts: ParsedMount[] = [];
  const routerNames = new Set<string>();
  const namedExports = new Set<string>();

  const addSymbol = (name: string, kind: ParsedSymbol["kind"], node: ts.Node, exported: boolean, callsFrom: ts.Node = node) => {
    symbols.push({
      name,
      kind,
      startLine: line(sf, node.getStart(sf)),
      endLine: line(sf, node.getEnd()),
      exported,
      calls: kind === "function" || kind === "class" || kind === "const" ? collectCalls(callsFrom) : [],
    });
  };

  // 1. Top-level declarations, imports and re-exports.
  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt)) {
      const spec = stringValue(stmt.moduleSpecifier);
      if (spec === undefined) continue;
      const { bindings, typeOnly } = importBindings(stmt.importClause);
      imports.push({ specifier: spec, line: line(sf, stmt.getStart(sf)), typeOnly, kind: "import", bindings });
    } else if (ts.isExportDeclaration(stmt)) {
      const spec = stringValue(stmt.moduleSpecifier);
      if (spec !== undefined) {
        imports.push({ specifier: spec, line: line(sf, stmt.getStart(sf)), typeOnly: stmt.isTypeOnly, kind: "export", bindings: [] });
      } else if (stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
        for (const el of stmt.exportClause.elements) namedExports.add((el.propertyName ?? el.name).text);
      }
    } else if (ts.isImportEqualsDeclaration(stmt) && ts.isExternalModuleReference(stmt.moduleReference)) {
      const spec = stringValue(stmt.moduleReference.expression);
      if (spec !== undefined) {
        imports.push({ specifier: spec, line: line(sf, stmt.getStart(sf)), typeOnly: stmt.isTypeOnly, kind: "require", bindings: [{ local: stmt.name.text, imported: "*" }] });
      }
    } else if (ts.isFunctionDeclaration(stmt)) {
      const name = stmt.name?.text ?? (hasDefault(stmt) ? "default" : undefined);
      if (name) addSymbol(name, "function", stmt, hasExport(stmt));
    } else if (ts.isClassDeclaration(stmt)) {
      const name = stmt.name?.text ?? (hasDefault(stmt) ? "default" : undefined);
      if (name) addSymbol(name, "class", stmt, hasExport(stmt));
    } else if (ts.isInterfaceDeclaration(stmt)) {
      addSymbol(stmt.name.text, "interface", stmt, hasExport(stmt));
    } else if (ts.isTypeAliasDeclaration(stmt)) {
      addSymbol(stmt.name.text, "type", stmt, hasExport(stmt));
    } else if (ts.isEnumDeclaration(stmt)) {
      addSymbol(stmt.name.text, "enum", stmt, hasExport(stmt));
    } else if (ts.isVariableStatement(stmt)) {
      const exported = hasExport(stmt);
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) continue;
        const init = decl.initializer;
        const isFn = init !== undefined && (ts.isArrowFunction(init) || ts.isFunctionExpression(init));
        addSymbol(decl.name.text, isFn ? "function" : "const", stmt, exported, decl);
        if (init && isRouterFactory(init)) routerNames.add(decl.name.text);
      }
    } else if (ts.isExportAssignment(stmt) && ts.isIdentifier(stmt.expression)) {
      namedExports.add(stmt.expression.text);
    }
  }
  for (const s of symbols) if (namedExports.has(s.name)) s.exported = true;

  // 2. require(), dynamic import() and route/mount calls anywhere in the file.
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee) && callee.text === "require") {
        const spec = stringValue(node.arguments[0]);
        if (spec !== undefined) imports.push({ specifier: spec, line: line(sf, node.getStart(sf)), typeOnly: false, kind: "require", bindings: requireBindings(node) });
      } else if (isTestMockCall(callee)) {
        // vi.mock('./x') / jest.mock('./x'): the test depends on that module even without importing it.
        const spec = stringValue(node.arguments[0]);
        if (spec !== undefined) imports.push({ specifier: spec, line: line(sf, node.getStart(sf)), typeOnly: false, kind: "mock", bindings: [] });
      } else if (callee.kind === ts.SyntaxKind.ImportKeyword) {
        const spec = stringValue(node.arguments[0]);
        if (spec !== undefined) imports.push({ specifier: spec, line: line(sf, node.getStart(sf)), typeOnly: false, kind: "dynamic", bindings: [] });
      } else if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) {
        const receiver = callee.expression.text;
        const method = callee.name.text;
        if (isRouterReceiver(receiver, routerNames)) {
          if (HTTP_METHODS.has(method)) {
            const path = stringValue(node.arguments[0]);
            const last = node.arguments[node.arguments.length - 1];
            if (path !== undefined && node.arguments.length >= 2 && last && !ts.isObjectLiteralExpression(last)) {
              const handler = dottedName(last as ts.Expression) ?? (ts.isArrowFunction(last) || ts.isFunctionExpression(last) ? "(inline)" : undefined);
              routes.push({ routerName: receiver, method: method.toUpperCase(), path, line: line(sf, node.getStart(sf)), handler });
            }
          } else if (method === "use") {
            const prefix = stringValue(node.arguments[0]);
            const target = node.arguments[1];
            if (prefix !== undefined && target && ts.isIdentifier(target)) mounts.push({ parent: receiver, prefix, routerName: target.text });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  const parseDiagnostics = (sf as unknown as { parseDiagnostics?: unknown[] }).parseDiagnostics;
  return { symbols, imports, routes, mounts, issues: parseDiagnostics?.length ?? 0 };
}

const MOCK_CALLS = new Set(["vi.mock", "vi.doMock", "vi.importActual", "jest.mock", "jest.doMock", "jest.requireActual", "jest.createMockFromModule"]);

function isTestMockCall(callee: ts.Expression): boolean {
  const name = dottedName(callee);
  return name !== undefined && MOCK_CALLS.has(name);
}

function isRouterFactory(init: ts.Expression): boolean {
  const call = ts.isNewExpression(init) || ts.isCallExpression(init) ? init.expression : undefined;
  if (!call) return false;
  const name = dottedName(call);
  if (!name) return false;
  return ROUTER_FACTORIES.has(name) || ROUTER_FACTORIES.has(name.split(".").pop() as string);
}

function isRouterReceiver(name: string, declared: Set<string>): boolean {
  return declared.has(name) || ROUTER_NAMES.has(name.toLowerCase());
}

function requireBindings(call: ts.CallExpression): ImportBinding[] {
  const parent = call.parent;
  if (ts.isVariableDeclaration(parent)) {
    if (ts.isIdentifier(parent.name)) return [{ local: parent.name.text, imported: "*" }];
    if (ts.isObjectBindingPattern(parent.name)) {
      return parent.name.elements.filter((e) => ts.isIdentifier(e.name)).map((e) => ({ local: (e.name as ts.Identifier).text, imported: (e.propertyName && ts.isIdentifier(e.propertyName) ? e.propertyName.text : (e.name as ts.Identifier).text) }));
    }
  }
  return [];
}
