"use client";

import { Suspense, useMemo, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { SearchMode, SearchResult } from "@/domain/types";
import { useExplorer } from "@/context/ExplorerContext";
import { searchRepository } from "@/lib/search";
import { PageHeader } from "@/components/ui/primitives";

const MODES: { id: SearchMode; label: string; hint: string }[] = [
  { id: "files", label: "Files", hint: "File and directory names" },
  { id: "text", label: "Text", hint: "Exact text in source" },
  { id: "symbols", label: "Symbols", hint: "Functions, classes, types" },
  { id: "semantic", label: "Semantic", hint: "Concepts, e.g. “how are payments handled”" },
];

export default function SearchPage() {
  return (
    <Suspense fallback={<p className="text-muted">Loading search…</p>}>
      <SearchView />
    </Suspense>
  );
}

function SearchView() {
  const { repo, openFile, invokeAi, aiStatus } = useExplorer();
  const router = useRouter();
  const params = useSearchParams();
  const urlQuery = params.get("q") ?? "";
  const urlMode = (params.get("mode") as SearchMode | null) ?? "text";
  const [input, setInput] = useState(urlQuery);
  const [syncedQuery, setSyncedQuery] = useState(urlQuery);
  const mode = MODES.some((m) => m.id === urlMode) ? urlMode : "text";

  // Keep the box in sync when the URL query changes (e.g. from the header search), without an effect.
  if (syncedQuery !== urlQuery) {
    setSyncedQuery(urlQuery);
    setInput(urlQuery);
  }

  const results = useMemo(() => searchRepository(repo, urlQuery, mode), [repo, urlQuery, mode]);
  const [ai, setAi] = useState<{ query: string; results: SearchResult[]; note?: string; provider: "gemini" | "mock"; fallback?: string } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const aiForQuery = ai && ai.query === urlQuery && mode === "semantic" ? ai : null;

  const rankWithAi = async () => {
    setAiBusy(true);
    setAiError(null);
    try {
      const outcome = await invokeAi({ task: "semantic-search", query: urlQuery });
      if (outcome.kind !== "search") throw new Error("Unexpected result.");
      setAi({
        query: urlQuery,
        note: outcome.note,
        provider: outcome.meta.provider,
        fallback: outcome.meta.fallbackReason,
        results: outcome.results.map((r) => ({ file: r.file, line: r.line, title: r.file, excerpt: r.reason, kind: "semantic" as const })),
      });
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "AI ranking failed.");
    } finally {
      setAiBusy(false);
    }
  };
  const shownResults = aiForQuery ? aiForQuery.results : results;

  const go = (q: string, m: SearchMode) => router.replace(`/search?q=${encodeURIComponent(q)}&mode=${m}`);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    go(input.trim(), mode);
  };

  return (
    <>
      <PageHeader title="Search" subtitle="Find files, text and symbols. Selecting a result opens the source at that line." />
      <form onSubmit={submit} className="d-flex gap-2 mb-2" role="search" aria-label="Search this repository">
        <label htmlFor="search-input" className="visually-hidden">
          Search query
        </label>
        <input id="search-input" className="form-control" placeholder="Search…" value={input} onChange={(e) => setInput(e.target.value)} autoFocus />
        <button type="submit" className="btn btn-primary">
          Search
        </button>
      </form>

      <div className="btn-group btn-group-sm mb-1" role="group" aria-label="Search mode">
        {MODES.map((m) => (
          <button key={m.id} type="button" className={`btn ${mode === m.id ? "btn-primary" : "btn-outline-primary"}`} aria-pressed={mode === m.id} onClick={() => go(input.trim(), m.id)}>
            {m.label}
          </button>
        ))}
      </div>
      <p className="text-muted small">{MODES.find((m) => m.id === mode)?.hint}</p>

      {urlQuery && (
        <p className="mb-2" aria-live="polite">
          {shownResults.length} result{shownResults.length === 1 ? "" : "s"} for “{urlQuery}”{aiForQuery ? (aiForQuery.provider === "gemini" ? " (ranked by Gemini)" : " (mock ranking)") : ""}
        </p>
      )}

      {mode === "semantic" && urlQuery && (
        <div className="mb-2 d-flex flex-wrap align-items-center gap-2">
          <button type="button" className="btn btn-sm btn-outline-primary" onClick={rankWithAi} disabled={aiBusy}>
            {aiBusy ? <span className="spinner-border spinner-border-sm me-1" aria-hidden="true" /> : <i className="bi bi-stars me-1" aria-hidden="true" />}
            Rank with AI{aiStatus?.provider === "gemini" ? " (Gemini)" : " (mock)"}
          </button>
          {aiForQuery?.note && <span className="text-muted small">{aiForQuery.note}</span>}
          {aiForQuery?.fallback && <span className="text-warning-emphasis small">Gemini unavailable: {aiForQuery.fallback}</span>}
          {aiError && (
            <span className="text-danger small" role="alert">
              {aiError}
            </span>
          )}
        </div>
      )}
      <ul className="list-unstyled d-flex flex-column gap-2">
        {shownResults.map((r, i) => (
          <li key={r.file + r.line + i}>
            <button
              type="button"
              className="cx-card w-100 text-start p-2 px-3 border"
              onClick={() => openFile(r.file, { start: r.line, end: r.line })}
              style={{ cursor: "pointer" }}
            >
              <div className="d-flex justify-content-between gap-2">
                <span className="mono text-primary">
                  {r.file}
                  {r.kind === "text" || r.kind === "symbols" ? `:${r.line}` : ""}
                </span>
                {r.kind === "semantic" && r.score !== undefined && <span className="chip">score {r.score}</span>}
              </div>
              {r.kind !== "files" && r.kind !== "text" && <div className="fw-semibold">{r.title}</div>}
              <div className="mono text-muted text-truncate">{r.excerpt}</div>
            </button>
          </li>
        ))}
      </ul>
      {urlQuery && shownResults.length === 0 && <p className="text-muted">No results. Text search is case-insensitive; try another mode.</p>}
      {mode === "semantic" && (
        <p className="text-muted small">Without AI ranking, semantic search is a keyword-and-synonym match. “Rank with AI” sends only the most relevant candidates (names, symbols, short excerpts) to the model, and every returned file is checked against the repository.</p>
      )}
    </>
  );
}
