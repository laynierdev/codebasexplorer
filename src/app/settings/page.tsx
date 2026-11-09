"use client";

import { useState, type FormEvent } from "react";
import { ZodError } from "zod";
import { DEFAULT_LIMITS, resolveLimits } from "@/analysis/limits";
import { IGNORED_DIRECTORIES, IGNORED_PATTERNS } from "@/analysis/ignore";
import { useExplorer } from "@/context/ExplorerContext";
import { PageHeader } from "@/components/ui/primitives";

const MB = 1024 * 1024;

export default function SettingsPage() {
  const { limits, setLimits, aiStatus } = useExplorer();
  const [maxArchiveMb, setMaxArchiveMb] = useState(limits.maxArchiveBytes / MB);
  const [maxFileKb, setMaxFileKb] = useState(limits.maxFileBytes / 1024);
  const [maxFiles, setMaxFiles] = useState(limits.maxFiles);
  const [extraIgnores, setExtraIgnores] = useState(limits.extraIgnores);
  const [respectGitignore, setRespectGitignore] = useState(limits.respectGitignore);
  const [newIgnore, setNewIgnore] = useState("");
  const [status, setStatus] = useState<{ kind: "saved" | "error"; text: string } | null>(null);

  const addIgnore = (e: FormEvent) => {
    e.preventDefault();
    const v = newIgnore.trim();
    if (v && !extraIgnores.includes(v)) setExtraIgnores([...extraIgnores, v]);
    setNewIgnore("");
  };

  const save = (e: FormEvent) => {
    e.preventDefault();
    try {
      const next = resolveLimits({
        maxArchiveBytes: Math.round(maxArchiveMb * MB),
        maxFileBytes: Math.round(maxFileKb * 1024),
        maxFiles: Math.round(maxFiles),
        extraIgnores,
        respectGitignore,
      });
      setLimits(next);
      setStatus({ kind: "saved", text: "Saved for this session. They apply to the next import." });
    } catch (err) {
      setStatus({ kind: "error", text: err instanceof ZodError ? "Every limit must be a positive number." : "Invalid settings." });
    }
  };

  const reset = () => {
    setMaxArchiveMb(DEFAULT_LIMITS.maxArchiveBytes / MB);
    setMaxFileKb(DEFAULT_LIMITS.maxFileBytes / 1024);
    setMaxFiles(DEFAULT_LIMITS.maxFiles);
    setExtraIgnores([]);
    setRespectGitignore(true);
    setLimits(DEFAULT_LIMITS);
    setStatus({ kind: "saved", text: "Defaults restored." });
  };

  return (
    <>
      <PageHeader title="Settings" subtitle="Analysis limits and AI provider. In this prototype changes apply to this session only; persistence arrives in Stage 4." />
      <div className="row g-3">
        <div className="col-lg-6">
          <section className="cx-card h-100">
            <h2 className="cx-card-title">AI provider</h2>
            <div className="cx-card-body">
              {aiStatus === null ? (
                <p className="text-muted mb-0">Could not read the AI status from the server.</p>
              ) : (
                <>
                  <dl className="row mb-2">
                    <dt className="col-sm-5">Answering now</dt>
                    <dd className="col-sm-7">{aiStatus.provider === "gemini" ? "Gemini" : "Mock provider"}</dd>
                    {aiStatus.model && (
                      <>
                        <dt className="col-sm-5">Model</dt>
                        <dd className="col-sm-7 mono">{aiStatus.model}</dd>
                      </>
                    )}
                    <dt className="col-sm-5">Mode (AI_PROVIDER)</dt>
                    <dd className="col-sm-7 mono">{aiStatus.mode}</dd>
                    <dt className="col-sm-5">API key</dt>
                    <dd className="col-sm-7">{aiStatus.keyConfigured ? "Configured on the server (never shown)" : "Not configured"}</dd>
                    <dt className="col-sm-5">Fallback to mock</dt>
                    <dd className="col-sm-7">{aiStatus.fallbackToMock ? "Yes, flagged in the UI" : "No, errors are shown"}</dd>
                  </dl>
                  {aiStatus.issues.map((i) => (
                    <div key={i} className="alert alert-warning py-1 px-2 small mb-1" role="status">
                      {i}
                    </div>
                  ))}
                </>
              )}
              <p className="text-muted small mb-0 mt-2">Configured with environment variables on the server (see .env.example). Only short context excerpts selected for each question are sent to the model, never the whole repository.</p>
            </div>
          </section>
        </div>

        <div className="col-lg-6">
          <section className="cx-card h-100">
            <h2 className="cx-card-title">Import limits</h2>
            <form className="cx-card-body d-flex flex-column gap-3" onSubmit={save}>
              <div>
                <label htmlFor="max-archive" className="form-label mb-1">
                  Max archive size (MB)
                </label>
                <input id="max-archive" type="number" min={1} step="any" className="form-control form-control-sm" value={maxArchiveMb} onChange={(e) => setMaxArchiveMb(Number(e.target.value))} />
              </div>
              <div>
                <label htmlFor="max-file" className="form-label mb-1">
                  Max file size (KB) <span className="text-muted">— larger files are skipped and reported</span>
                </label>
                <input id="max-file" type="number" min={1} step="any" className="form-control form-control-sm" value={maxFileKb} onChange={(e) => setMaxFileKb(Number(e.target.value))} />
              </div>
              <div>
                <label htmlFor="max-files" className="form-label mb-1">
                  Max files analyzed
                </label>
                <input id="max-files" type="number" min={1} className="form-control form-control-sm" value={maxFiles} onChange={(e) => setMaxFiles(Number(e.target.value))} />
              </div>
              <div className="form-check">
                <input className="form-check-input" type="checkbox" id="gitignore" checked={respectGitignore} onChange={(e) => setRespectGitignore(e.target.checked)} />
                <label className="form-check-label" htmlFor="gitignore">
                  Respect .gitignore when present
                </label>
              </div>
              <div className="d-flex align-items-center gap-2 flex-wrap">
                <button type="submit" className="btn btn-primary btn-sm">
                  Save settings
                </button>
                <button type="button" className="btn btn-outline-secondary btn-sm" onClick={reset}>
                  Restore defaults
                </button>
                {status && (
                  <span className={status.kind === "saved" ? "text-success" : "text-danger"} role={status.kind === "error" ? "alert" : "status"}>
                    {status.text}
                  </span>
                )}
              </div>
            </form>
          </section>
        </div>

        <div className="col-12">
          <section className="cx-card">
            <h2 className="cx-card-title">Ignored paths</h2>
            <div className="cx-card-body">
              <p className="text-muted">Ignored items are never read or analyzed, but every skipped item is listed in the analysis summary.</p>
              <div className="stat-label mb-1">Always ignored (built in)</div>
              <div className="d-flex flex-wrap gap-1 mb-3">
                {[...IGNORED_DIRECTORIES].map((d) => (
                  <span key={d} className="chip mono">
                    {d}/
                  </span>
                ))}
                {IGNORED_PATTERNS.map((p) => (
                  <span key={p} className="chip mono">
                    {p}
                  </span>
                ))}
              </div>
              <div className="stat-label mb-1">Your extra patterns (.gitignore syntax)</div>
              <div className="d-flex flex-wrap gap-2 mb-3">
                {extraIgnores.length === 0 && <span className="text-muted">None.</span>}
                {extraIgnores.map((p) => (
                  <span key={p} className="chip mono">
                    {p}
                    <button type="button" className="btn-close ms-1" style={{ fontSize: "0.55rem" }} aria-label={`Remove ${p}`} onClick={() => setExtraIgnores(extraIgnores.filter((x) => x !== p))} />
                  </span>
                ))}
              </div>
              <form onSubmit={addIgnore} className="d-flex gap-2" style={{ maxWidth: 420 }}>
                <label htmlFor="new-ignore" className="visually-hidden">
                  New ignore pattern
                </label>
                <input id="new-ignore" className="form-control form-control-sm mono" placeholder="e.g. vendor/ or *.generated.ts" value={newIgnore} onChange={(e) => setNewIgnore(e.target.value)} />
                <button type="submit" className="btn btn-outline-primary btn-sm">
                  Add
                </button>
              </form>
              <p className="text-muted small mt-2 mb-0">Remember to press “Save settings” to apply added or removed patterns.</p>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
