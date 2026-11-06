"use client";

import { useState, type FormEvent } from "react";
import { PageHeader } from "@/components/ui/primitives";

const DEFAULT_IGNORES = ["node_modules/", ".git/", "dist/", "build/", ".next/", "coverage/", ".cache/", "*.lock", "package-lock.json"];

export default function SettingsPage() {
  const [maxArchiveMb, setMaxArchiveMb] = useState(50);
  const [maxFileKb, setMaxFileKb] = useState(1024);
  const [maxFiles, setMaxFiles] = useState(10000);
  const [ignores, setIgnores] = useState(DEFAULT_IGNORES);
  const [newIgnore, setNewIgnore] = useState("");
  const [respectGitignore, setRespectGitignore] = useState(true);
  const [saved, setSaved] = useState(false);

  const addIgnore = (e: FormEvent) => {
    e.preventDefault();
    const v = newIgnore.trim();
    if (v && !ignores.includes(v)) setIgnores([...ignores, v]);
    setNewIgnore("");
  };

  return (
    <>
      <PageHeader title="Settings" subtitle="Analysis limits and AI provider. In this prototype changes apply to this session only; persistence arrives in Stage 4." />
      <div className="row g-3">
        <div className="col-lg-6">
          <section className="cx-card h-100">
            <h2 className="cx-card-title">AI provider</h2>
            <div className="cx-card-body">
              <div className="form-check">
                <input className="form-check-input" type="radio" name="provider" id="p-mock" defaultChecked />
                <label className="form-check-label" htmlFor="p-mock">
                  Mock provider <span className="text-muted">— works without credentials, answers from the analyzed repository</span>
                </label>
              </div>
              <div className="form-check">
                <input className="form-check-input" type="radio" name="provider" id="p-gemini" disabled />
                <label className="form-check-label text-muted" htmlFor="p-gemini">
                  Gemini <span>— available in Stage 3. The API key will stay server-side.</span>
                </label>
              </div>
            </div>
          </section>
        </div>

        <div className="col-lg-6">
          <section className="cx-card h-100">
            <h2 className="cx-card-title">Import limits</h2>
            <form
              className="cx-card-body d-flex flex-column gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                setSaved(true);
              }}
            >
              <div>
                <label htmlFor="max-archive" className="form-label mb-1">
                  Max archive size (MB)
                </label>
                <input id="max-archive" type="number" min={1} className="form-control form-control-sm" value={maxArchiveMb} onChange={(e) => setMaxArchiveMb(Number(e.target.value))} />
              </div>
              <div>
                <label htmlFor="max-file" className="form-label mb-1">
                  Max file size (KB)
                </label>
                <input id="max-file" type="number" min={1} className="form-control form-control-sm" value={maxFileKb} onChange={(e) => setMaxFileKb(Number(e.target.value))} />
              </div>
              <div>
                <label htmlFor="max-files" className="form-label mb-1">
                  Max files per archive
                </label>
                <input id="max-files" type="number" min={1} className="form-control form-control-sm" value={maxFiles} onChange={(e) => setMaxFiles(Number(e.target.value))} />
              </div>
              <div className="form-check">
                <input className="form-check-input" type="checkbox" id="gitignore" checked={respectGitignore} onChange={(e) => setRespectGitignore(e.target.checked)} />
                <label className="form-check-label" htmlFor="gitignore">
                  Respect .gitignore when present
                </label>
              </div>
              <div>
                <button type="submit" className="btn btn-primary btn-sm">
                  Save settings
                </button>
                {saved && (
                  <span className="ms-2 text-success" role="status">
                    Saved for this session.
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
              <p className="text-muted">Ignored items are never analyzed, but every skipped item is listed in the analysis summary.</p>
              <div className="d-flex flex-wrap gap-2 mb-3">
                {ignores.map((p) => (
                  <span key={p} className="chip mono">
                    {p}
                    <button type="button" className="btn-close ms-1" style={{ fontSize: "0.55rem" }} aria-label={`Remove ${p}`} onClick={() => setIgnores(ignores.filter((x) => x !== p))} />
                  </span>
                ))}
              </div>
              <form onSubmit={addIgnore} className="d-flex gap-2" style={{ maxWidth: 420 }}>
                <label htmlFor="new-ignore" className="visually-hidden">
                  New ignore pattern
                </label>
                <input id="new-ignore" className="form-control form-control-sm mono" placeholder="e.g. vendor/" value={newIgnore} onChange={(e) => setNewIgnore(e.target.value)} />
                <button type="submit" className="btn btn-outline-primary btn-sm">
                  Add
                </button>
              </form>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
