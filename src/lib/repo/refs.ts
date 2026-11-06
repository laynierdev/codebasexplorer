import type { Repository, SourceFile, SourceRef, SourceSymbol } from "@/domain/types";

export function getFile(repo: Repository, path: string): SourceFile | undefined {
  return repo.files.find((f) => f.path === path);
}

export function getSymbols(repo: Repository, path: string): SourceSymbol[] {
  return repo.symbols.filter((s) => s.file === path);
}

export function findSymbol(repo: Repository, file: string, name: string): SourceSymbol | undefined {
  return repo.symbols.find((s) => s.file === file && s.name === name);
}

/**
 * Builds a reference only if the file and symbol really exist in the repository.
 * Returns undefined otherwise — references are never invented.
 */
export function refForSymbol(repo: Repository, file: string, name: string): SourceRef | undefined {
  const symbol = findSymbol(repo, file, name);
  if (!symbol) return undefined;
  return { file, startLine: symbol.startLine, endLine: symbol.endLine, symbol: name };
}

export function refForLines(repo: Repository, file: string, startLine: number, endLine: number): SourceRef | undefined {
  const f = getFile(repo, file);
  if (!f || startLine < 1 || endLine < startLine || endLine > f.lineCount) return undefined;
  return { file, startLine, endLine };
}

/** Returns the lines of a reference (1-indexed, inclusive), or undefined if it is invalid. */
export function excerpt(repo: Repository, ref: SourceRef): string | undefined {
  const f = getFile(repo, ref.file);
  if (!f || ref.startLine < 1 || ref.endLine > f.lineCount) return undefined;
  return f.content
    .split("\n")
    .slice(ref.startLine - 1, ref.endLine)
    .join("\n");
}

export function lineOfText(repo: Repository, file: string, needle: string): number | undefined {
  const f = getFile(repo, file);
  if (!f) return undefined;
  const idx = f.content.split("\n").findIndex((l) => l.includes(needle));
  return idx >= 0 ? idx + 1 : undefined;
}

export function compact<T>(items: (T | undefined)[]): T[] {
  return items.filter((i): i is T => i !== undefined);
}
