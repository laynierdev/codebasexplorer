/** Where a name imported into a file really comes from. */
export interface BoundName {
  /** Resolved project file, or null when the import is external/unresolved. */
  file: string | null;
  /** Exported name in the target file ("default", "*" for namespace). */
  imported: string;
  specifier: string;
}

/** Per-file index of imported names, used to follow calls and route handlers across files. */
export class BindingIndex {
  private readonly byFile = new Map<string, Map<string, BoundName>>();

  add(file: string, local: string, bound: BoundName): void {
    let map = this.byFile.get(file);
    if (!map) {
      map = new Map();
      this.byFile.set(file, map);
    }
    map.set(local, bound);
  }

  lookup(file: string, local: string): BoundName | undefined {
    return this.byFile.get(file)?.get(local);
  }

  /**
   * Resolves a call or handler name used in `file` to a project symbol.
   * `login` → imported function; `ctrl.login` → namespace import member; local names stay in the same file.
   */
  resolveName(file: string, name: string, hasLocalSymbol: (file: string, symbol: string) => boolean): { file: string; symbol: string } | undefined {
    const [head, ...rest] = name.split(".");
    if (!head) return undefined;
    const bound = this.lookup(file, head);
    if (bound?.file) {
      if (bound.imported === "*" || bound.imported === "default") {
        // Namespace/CommonJS object: `ns.fn()` targets `fn` in the module; a bare default import targets "default".
        if (rest.length >= 1) return { file: bound.file, symbol: rest[0] as string };
        return { file: bound.file, symbol: bound.imported === "default" ? "default" : head };
      }
      return { file: bound.file, symbol: bound.imported };
    }
    if (!bound && hasLocalSymbol(file, head)) return { file, symbol: head };
    return undefined;
  }
}
