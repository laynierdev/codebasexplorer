"use client";

import { useMemo, useState } from "react";
import { useExplorer } from "@/context/ExplorerContext";
import { computeImpact, layerOf, mostImported } from "@/lib/graph/analysis";
import { getSymbols } from "@/lib/repo/refs";
import { FileList, PageHeader, SourceLink } from "@/components/ui/primitives";
import type { Layer } from "@/domain/types";

/** Potential (unconfirmed) impacts by layer. These are reasoning prompts, not detected facts. */
const POTENTIAL: Partial<Record<Layer, string[]>> = {
  service: ["Controllers that call this service may rely on its thrown HttpError status codes.", "Callers outside this repository (jobs, other services) are not visible."],
  repository: ["SQL column names are coupled to the database schema in scripts/seed.sql.", "Changing return shapes affects every service that reads them."],
  controller: ["HTTP response shapes are part of the public API contract."],
  route: ["Changing a path or method breaks API clients."],
  middleware: ["Middleware runs on many routes; behavior changes apply broadly."],
  model: ["Shared types ripple into almost every layer and into the database mapping."],
  config: ["Environment variable changes require deployment configuration updates."],
  database: ["Every repository depends on the shared query helper and pool settings."],
};

export default function ImpactPage() {
  const { repo, ask, setAssistantOpen } = useExplorer();
  const parsed = useMemo(() => repo.files.filter((f) => f.parsed), [repo]);
  const [target, setTarget] = useState(() => mostImported(repo) ?? parsed[0]?.path ?? "");
  const [symbol, setSymbol] = useState("");

  const result = useMemo(() => computeImpact(repo, target), [repo, target]);
  const symbols = getSymbols(repo, target);
  const potential = POTENTIAL[layerOf(target)] ?? [];
  const label = symbol ? `${symbol} in ${target}` : target;

  return (
    <>
      <PageHeader title="Impact analysis" subtitle="See what could be affected by changing a file or symbol. Confirmed results come from static imports; potential impacts are reasoning, not proof." />

      <div className="cx-card mb-3">
        <div className="cx-card-body row g-3 align-items-end">
          <div className="col-md-6">
            <label htmlFor="impact-file" className="form-label mb-1">
              File
            </label>
            <select
              id="impact-file"
              className="form-select form-select-sm mono"
              value={target}
              onChange={(e) => {
                setTarget(e.target.value);
                setSymbol("");
              }}
            >
              {parsed.map((f) => (
                <option key={f.path} value={f.path}>
                  {f.path}
                </option>
              ))}
            </select>
          </div>
          <div className="col-md-3">
            <label htmlFor="impact-symbol" className="form-label mb-1">
              Symbol (optional)
            </label>
            <select id="impact-symbol" className="form-select form-select-sm mono" value={symbol} onChange={(e) => setSymbol(e.target.value)}>
              <option value="">Whole file</option>
              {symbols.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="col-md-3">
            <button
              type="button"
              className="btn btn-sm btn-outline-primary w-100"
              onClick={() => {
                setAssistantOpen(true);
                ask(`What could be affected if I modify ${target}?`);
              }}
            >
              <i className="bi bi-stars me-1" aria-hidden="true" />
              Ask AI about this change
            </button>
          </div>
        </div>
      </div>

      <div className="alert alert-secondary" role="note">
        {symbol ? "Symbol-level tracking arrives in a later stage, so results below are computed for the whole file. " : ""}
        This tool cannot guarantee that every affected component is found: dynamic usage, runtime wiring and consumers outside this repository are invisible to static analysis.
      </div>

      <h2 className="h6 mb-2">If you change <span className="mono">{label}</span></h2>
      <div className="row g-3">
        <div className="col-lg-6">
          <section className="cx-card h-100">
            <h3 className="cx-card-title">
              Direct dependents <span className="evidence fact">Confirmed</span>
            </h3>
            <div className="cx-card-body">
              <FileList files={result.directDependents} empty="No file imports this one directly." />
            </div>
          </section>
        </div>
        <div className="col-lg-6">
          <section className="cx-card h-100">
            <h3 className="cx-card-title">
              Transitive dependents <span className="evidence fact">Confirmed</span>
            </h3>
            <div className="cx-card-body">
              <FileList files={result.transitiveDependents} empty="No indirect dependents." />
            </div>
          </section>
        </div>
        <div className="col-lg-6">
          <section className="cx-card h-100">
            <h3 className="cx-card-title">
              Tests that import it (directly or not) <span className="evidence fact">Confirmed</span>
            </h3>
            <div className="cx-card-body">
              <FileList files={result.affectedTests} empty="No test imports this file, even transitively. It may still be covered at runtime." />
            </div>
          </section>
        </div>
        <div className="col-lg-6">
          <section className="cx-card h-100">
            <h3 className="cx-card-title">
              API endpoints reached <span className="evidence fact">Confirmed</span>
            </h3>
            <div className="cx-card-body">
              {result.affectedRoutes.length ? (
                <ul className="list-unstyled mb-0 d-flex flex-column gap-1">
                  {result.affectedRoutes.map((e) => (
                    <li key={e.method + e.path}>
                      <span className="chip mono me-2">
                        {e.method} {e.path}
                      </span>
                      <SourceLink file={e.file} start={e.line} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted mb-0">No route file reaches this file through imports.</p>
              )}
            </div>
          </section>
        </div>
        <div className="col-lg-6">
          <section className="cx-card h-100">
            <h3 className="cx-card-title">
              Potential impacts <span className="evidence inference">Inference</span>
            </h3>
            <div className="cx-card-body">
              {potential.length ? (
                <ul className="mb-0">
                  {potential.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted mb-0">No specific risks suggested for this kind of file.</p>
              )}
              {result.cycles.length > 0 && (
                <p className="mt-2 mb-0 text-warning-emphasis">
                  Part of a circular dependency: {result.cycles.map((c) => c.join(" ⇄ ")).join("; ")}. Changes can loop back.
                </p>
              )}
            </div>
          </section>
        </div>
        <div className="col-lg-6">
          <section className="cx-card h-100">
            <h3 className="cx-card-title">
              Review before changing <span className="evidence recommendation">Recommendation</span>
            </h3>
            <div className="cx-card-body">
              <ul className="mb-0">
                <li>Read every direct dependent listed above.</li>
                <li>Run or update the tests listed above{result.affectedTests.length === 0 ? " (none found: consider adding one)" : ""}.</li>
                <li>Check API contracts of the endpoints listed above.</li>
                <li>Search for dynamic usage of the file or its exports in the Search view.</li>
              </ul>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
