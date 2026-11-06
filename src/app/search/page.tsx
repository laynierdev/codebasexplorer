"use client";

import { Suspense, useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { SearchMode } from "@/domain/types";
import { useExplorer } from "@/context/ExplorerContext";
import { searchRepository } from "@/lib/search";
import { PageHeader } from "@/components/ui/primitives";

const MODES: { id: SearchMode; label: string; hint: string }[] = [
  { id: "files", label: "Files", hint: "File and directory names" },
  { id: "text", label: "Text", hint: "Exact text in source" },
  { id: "symbols", label: "Symbols", hint: "Functions, classes, types" },
  { id: "semantic", label: "Semantic (mock)", hint: "Concepts, e.g. “how are payments handled”" },
];

export default function SearchPage() {
  return (
    <Suspense fallback={<p className="text-muted">Loading search…</p>}>
      <SearchView />
    </Suspense>
  );
}

function SearchView() {
  const { repo, openFile } = useExplorer();
  const router = useRouter();
  const params = useSearchParams();
  const urlQuery = params.get("q") ?? "";
  const urlMode = (params.get("mode") as SearchMode | null) ?? "text";
  const [input, setInput] = useState(urlQuery);
  const mode = MODES.some((m) => m.id === urlMode) ? urlMode : "text";

  useEffect(() => setInput(urlQuery), [urlQuery]);

  const results = useMemo(() => searchRepository(repo, urlQuery, mode), [repo, urlQuery, mode]);

  const go = (q: string, m: SearchMode) => router.replace(`/search?q=${encodeURIComponent(q)}&mode=${m}`);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    go(input.trim(), mode);
  };

  return (
    <>
      <PageHeader title="Search" subtitle="Find files, text and symbols. Selecting a result opens the source at that line." />
      <form onSubmit={submit} className="d-flex gap-2 mb-2" role="search">
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
          {results.length} result{results.length === 1 ? "" : "s"} for “{urlQuery}”
        </p>
      )}

      <ul className="list-unstyled d-flex flex-column gap-2">
        {results.map((r, i) => (
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
                {r.kind === "semantic" && <span className="chip">score {r.score}</span>}
              </div>
              {r.kind !== "files" && r.kind !== "text" && <div className="fw-semibold">{r.title}</div>}
              <div className="mono text-muted text-truncate">{r.excerpt}</div>
            </button>
          </li>
        ))}
      </ul>
      {urlQuery && results.length === 0 && <p className="text-muted">No results. Text search is case-insensitive; try another mode.</p>}
      {mode === "semantic" && (
        <p className="text-muted small">Semantic search is a keyword-and-synonym mock in this prototype. Gemini-assisted retrieval arrives in Stage 3.</p>
      )}
    </>
  );
}
