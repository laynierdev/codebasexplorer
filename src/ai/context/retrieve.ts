import type { Repository } from "@/domain/types";

/**
 * Lexical retrieval over the analyzed repository: path, symbol, description and content matches,
 * with fuzzy prefix matching and a small graph expansion. Deterministic and runs in the browser,
 * so the whole repository never has to leave the machine to find relevant files.
 */

const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "of", "to", "in", "on", "for", "and", "or", "how", "where", "what", "why", "when", "does", "do", "did", "with",
  "this", "that", "it", "its", "by", "from", "work", "works", "working", "code", "file", "files", "me", "my", "i", "can", "should", "would", "which", "there", "about",
  "explain", "show", "find", "tell", "use", "used", "uses", "using", "implement", "implemented", "happens", "happen",
  "el", "la", "los", "las", "un", "una", "de", "del", "en", "que", "como", "donde", "por", "para", "con", "es", "se",
]);

export function tokenize(text: string): string[] {
  const words = text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/);
  const out: string[] = [];
  for (const w of words) {
    if (w.length < 2 || STOPWORDS.has(w)) continue;
    out.push(stem(w));
  }
  return out;
}

function stem(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith("ies") && word.length > 4) return word.slice(0, -3) + "y";
  if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

interface Doc {
  path: string;
  pathTokens: Set<string>;
  symbolTokens: Set<string>;
  purposeTokens: Set<string>;
  terms: Map<string, number>;
}

interface Index {
  docs: Doc[];
  df: Map<string, number>;
  vocabulary: string[];
}

const cache = new WeakMap<Repository, Index>();

function buildIndex(repo: Repository): Index {
  const symbolsByFile = new Map<string, string[]>();
  for (const s of repo.symbols) symbolsByFile.set(s.file, [...(symbolsByFile.get(s.file) ?? []), s.name]);
  const df = new Map<string, number>();
  const docs: Doc[] = repo.files.map((f) => {
    const terms = new Map<string, number>();
    for (const t of tokenize(f.content.slice(0, 200_000))) terms.set(t, (terms.get(t) ?? 0) + 1);
    for (const t of terms.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    return {
      path: f.path,
      pathTokens: new Set(tokenize(f.path)),
      symbolTokens: new Set(tokenize((symbolsByFile.get(f.path) ?? []).join(" "))),
      purposeTokens: new Set(tokenize(f.purpose)),
      terms,
    };
  });
  return { docs, df, vocabulary: [...df.keys()] };
}

export interface RankedFile {
  path: string;
  score: number;
  reasons: string[];
}

export interface RankOptions {
  selectedFile?: string;
  limit?: number;
  /** Include test files at full weight (otherwise they are down-weighted). */
  includeTests?: boolean;
}

/** Tokens in the vocabulary that a query token should match: itself, plus prefix relatives (auth ~ authentication). */
function expand(token: string, index: Index): { token: string; weight: number }[] {
  const out = [{ token, weight: 1 }];
  if (token.length >= 4) {
    for (const v of index.vocabulary) {
      if (v !== token && v.length >= 4 && (v.startsWith(token) || token.startsWith(v))) out.push({ token: v, weight: 0.55 });
      if (out.length > 12) break;
    }
  }
  return out;
}

export function rankFiles(repo: Repository, query: string, options: RankOptions = {}): RankedFile[] {
  let index = cache.get(repo);
  if (!index) {
    index = buildIndex(repo);
    cache.set(repo, index);
  }
  const queryTokens = [...new Set(tokenize(query))];
  const lowerQuery = query.toLowerCase();
  const mentionsTests = /\b(test|tests|spec|testing)\b/i.test(query);
  const n = index.docs.length || 1;
  const scores = new Map<string, RankedFile>();

  for (const doc of index.docs) {
    let score = 0;
    const reasons: string[] = [];
    for (const qt of queryTokens) {
      for (const { token, weight } of expand(qt, index)) {
        const idf = Math.log(1 + n / (1 + (index.df.get(token) ?? 0)));
        let s = 0;
        if (doc.pathTokens.has(token)) {
          s += 3;
          reasons.push(`path:${token}`);
        }
        if (doc.symbolTokens.has(token)) {
          s += 2.5;
          reasons.push(`symbol:${token}`);
        }
        if (doc.purposeTokens.has(token)) s += 1.2;
        const count = doc.terms.get(token) ?? 0;
        if (count > 0) s += Math.min(2, Math.log(1 + count));
        score += idf * s * weight;
      }
    }
    if (lowerQuery.includes(doc.path.toLowerCase())) {
      score += 20;
      reasons.push("path mentioned");
    }
    if (score > 0) scores.set(doc.path, { path: doc.path, score, reasons: [...new Set(reasons)].slice(0, 6) });
  }

  // Exact symbol names mentioned in the query (case-sensitive identifiers such as placeOrder).
  const identifiers: string[] = query.match(/[A-Za-z_][A-Za-z0-9_]{3,}/g) ?? [];
  for (const sym of repo.symbols) {
    if (identifiers.includes(sym.name)) {
      const r: RankedFile = scores.get(sym.file) ?? { path: sym.file, score: 0, reasons: [] };
      r.score += 6;
      r.reasons.push(`symbol ${sym.name}`);
      scores.set(sym.file, r);
    }
  }

  const ranked = [...scores.values()];
  for (const r of ranked) {
    const file = repo.files.find((f) => f.path === r.path);
    if (!options.includeTests && !mentionsTests && file?.kind === "test") r.score *= 0.6;
    if (options.selectedFile === r.path) r.score *= 1.3;
  }
  ranked.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));

  // Graph expansion: pull in direct neighbors of the strongest hits at a fraction of their score.
  const top = ranked.slice(0, 3);
  const present = new Set(ranked.map((r) => r.path));
  for (const hub of top) {
    for (const d of repo.dependencies) {
      const neighbor = d.from === hub.path ? d.to : d.to === hub.path ? d.from : null;
      if (neighbor && !present.has(neighbor)) {
        present.add(neighbor);
        ranked.push({ path: neighbor, score: hub.score * 0.25, reasons: [`neighbor of ${hub.path}`] });
      }
    }
  }
  ranked.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return ranked.slice(0, options.limit ?? 10);
}

/** Lines of a file that mention any of the query tokens, best (most distinct tokens) first. */
export function bestLines(content: string, query: string, max = 3): number[] {
  const tokens = [...new Set(tokenize(query))];
  if (tokens.length === 0) return [];
  const scored: { line: number; score: number }[] = [];
  content.split("\n").forEach((text, i) => {
    const lineTokens = new Set(tokenize(text));
    let score = 0;
    for (const t of tokens) if (lineTokens.has(t)) score++;
    if (score > 0) scored.push({ line: i + 1, score });
  });
  return scored.sort((a, b) => b.score - a.score || a.line - b.line).slice(0, max).map((s) => s.line);
}
