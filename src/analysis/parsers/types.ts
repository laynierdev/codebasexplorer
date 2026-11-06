import type { Language, SymbolKind } from "@/domain/types";

export interface ImportBinding {
  /** Name used inside the importing file. */
  local: string;
  /** Name exported by the target ("default" for default imports, "*" for namespace/require objects). */
  imported: string;
}

export interface ParsedImport {
  specifier: string;
  line: number;
  typeOnly: boolean;
  kind: "import" | "export" | "require" | "dynamic" | "mock";
  bindings: ImportBinding[];
}

export interface ParsedSymbol {
  name: string;
  kind: SymbolKind;
  startLine: number;
  endLine: number;
  exported: boolean;
  /** Names of functions/objects called inside the symbol (identifiers or dotted paths). */
  calls: string[];
}

/** `router.post('/login', requireAuth, login)` */
export interface ParsedRoute {
  routerName: string;
  method: string;
  path: string;
  line: number;
  /** Last argument when it is an identifier or property access; "(inline)" for inline functions. */
  handler?: string;
}

/** `app.use('/api/orders', ordersRouter)` */
export interface ParsedMount {
  /** The app/router the target is mounted on (`app` in `app.use(...)`). */
  parent: string;
  prefix: string;
  routerName: string;
}

export interface ParseResult {
  symbols: ParsedSymbol[];
  imports: ParsedImport[];
  routes: ParsedRoute[];
  mounts: ParsedMount[];
  /** Number of syntax diagnostics. Parsing is tolerant, so partial results are still returned. */
  issues: number;
}

/** Modular parsing strategy: each parser handles a set of languages and never executes the code. */
export interface LanguageParser {
  id: string;
  languages: Language[];
  parse(path: string, content: string): ParseResult;
}
