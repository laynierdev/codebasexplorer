import type { Repository, SearchMode, SearchResult } from "@/domain/types";

const MAX_RESULTS = 100;

const STOPWORDS = new Set(["the", "a", "an", "is", "are", "of", "to", "in", "on", "for", "and", "how", "where", "what", "does", "do", "with", "this", "that", "code", "handle", "handles"]);

/** Tiny concept map used by the MOCK semantic search. Stage 3 replaces this with Gemini-assisted retrieval. */
const SYNONYMS: Record<string, string[]> = {
  login: ["auth", "token", "password", "credentials"],
  authentication: ["auth", "token", "jwt", "login"],
  authorization: ["auth", "role", "token"],
  payment: ["stripe", "charge", "order"],
  money: ["payment", "charge", "stripe"],
  email: ["smtp", "mail", "receipt", "verification"],
  database: ["sql", "query", "repository", "pool"],
  db: ["sql", "query", "repository", "pool"],
  error: ["error", "httperror", "handler"],
  config: ["env", "environment", "settings"],
  startup: ["server", "listen", "main"],
};

export function searchRepository(repo: Repository, query: string, mode: SearchMode): SearchResult[] {
  const q = query.trim();
  if (!q) return [];
  switch (mode) {
    case "files":
      return searchFiles(repo, q);
    case "text":
      return searchText(repo, q);
    case "symbols":
      return searchSymbols(repo, q);
    case "semantic":
      return searchSemantic(repo, q);
  }
}

function searchFiles(repo: Repository, q: string): SearchResult[] {
  const needle = q.toLowerCase();
  return repo.files
    .filter((f) => f.path.toLowerCase().includes(needle))
    .slice(0, MAX_RESULTS)
    .map((f) => ({ file: f.path, line: 1, title: f.path, excerpt: f.purpose, kind: "files" as const }));
}

function searchText(repo: Repository, q: string): SearchResult[] {
  const needle = q.toLowerCase();
  const results: SearchResult[] = [];
  for (const f of repo.files) {
    const lines = f.content.split("\n");
    for (let i = 0; i < lines.length && results.length < MAX_RESULTS; i++) {
      if ((lines[i] ?? "").toLowerCase().includes(needle)) {
        results.push({ file: f.path, line: i + 1, title: f.path + ":" + (i + 1), excerpt: (lines[i] ?? "").trim(), kind: "text" });
      }
    }
  }
  return results;
}

function searchSymbols(repo: Repository, q: string): SearchResult[] {
  const needle = q.toLowerCase();
  return repo.symbols
    .filter((s) => s.name.toLowerCase().includes(needle))
    .slice(0, MAX_RESULTS)
    .map((s) => {
      const file = repo.files.find((f) => f.path === s.file);
      const line = (file?.content.split("\n")[s.startLine - 1] ?? "").trim();
      return { file: s.file, line: s.startLine, title: s.kind + " " + s.name, excerpt: line, kind: "symbols" as const };
    });
}

function searchSemantic(repo: Repository, q: string): SearchResult[] {
  const tokens = q
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !STOPWORDS.has(t));
  const expanded = new Set<string>(tokens);
  for (const t of tokens) for (const s of SYNONYMS[t] ?? []) expanded.add(s);

  const scored = repo.files
    .filter((f) => f.parsed || f.kind === "script")
    .map((f) => {
      const haystack = (f.path + " " + f.purpose + " " + repo.symbols.filter((s) => s.file === f.path).map((s) => s.name).join(" ")).toLowerCase();
      let score = 0;
      for (const t of expanded) if (haystack.includes(t)) score += tokens.includes(t) ? 2 : 1;
      return { f, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  return scored.map(({ f, score }) => ({
    file: f.path,
    line: repo.symbols.find((s) => s.file === f.path)?.startLine ?? 1,
    title: f.path,
    excerpt: f.purpose,
    kind: "semantic" as const,
    score,
  }));
}
