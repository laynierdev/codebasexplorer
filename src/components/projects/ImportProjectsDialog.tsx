"use client";

import { useState } from "react";
import { formatBytes } from "@/analysis/ignore";
import { useProjects } from "@/context/ProjectsContext";
import { Modal } from "@/components/ui/Modal";
import type { ImportReport, ParsedImport, Resolution } from "@/persistence/exportImport";
import { ImportError } from "@/persistence/migrate";

type Step = { kind: "pick" } | { kind: "review"; parsed: ParsedImport } | { kind: "done"; report: ImportReport };

const RESULT_LABEL: Record<string, string> = { added: "Imported", replaced: "Replaced", copied: "Imported as a copy", skipped: "Skipped", failed: "Failed" };

/** Imports projects from a JSON export file: validate, show what is inside, resolve conflicts, then import. */
export function ImportProjectsDialog({ onClose }: { onClose: () => void }) {
  const { previewImport, applyImport, persistent } = useProjects();
  const [step, setStep] = useState<Step>({ kind: "pick" });
  const [error, setError] = useState<{ message: string; issues: string[] } | null>(null);
  const [working, setWorking] = useState(false);
  /** Per project id: how to handle it. Non-conflicting projects default to "replace" meaning "import". */
  const [choices, setChoices] = useState<Record<string, Resolution>>({});

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setWorking(true);
    try {
      const parsed = await previewImport(file);
      // Conflicts default to the safe choice: keep the existing project.
      setChoices(Object.fromEntries(parsed.candidates.map((c) => [c.project.meta.id, c.existing ? "skip" : "replace"])));
      setStep({ kind: "review", parsed });
    } catch (err) {
      setError(err instanceof ImportError ? { message: err.message, issues: err.issues } : { message: err instanceof Error ? err.message : "The file could not be read.", issues: [] });
    } finally {
      setWorking(false);
    }
  };

  const confirm = async (parsed: ParsedImport) => {
    setWorking(true);
    setError(null);
    try {
      setStep({ kind: "done", report: await applyImport(parsed, choices) });
    } catch (err) {
      setError({ message: err instanceof Error ? err.message : "The import failed.", issues: [] });
    } finally {
      setWorking(false);
    }
  };

  const conflicts = step.kind === "review" ? step.parsed.candidates.filter((c) => c.existing).length : 0;
  const toImport = step.kind === "review" ? step.parsed.candidates.filter((c) => (c.existing ? choices[c.project.meta.id] !== "skip" : choices[c.project.meta.id] !== "skip")).length : 0;

  return (
    <Modal
      title="Import saved projects (.json)"
      onClose={onClose}
      locked={working}
      size="lg"
      footer={
        step.kind === "review" ? (
          <>
            <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setStep({ kind: "pick" })} disabled={working}>
              Choose another file
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => confirm(step.parsed)} disabled={working || toImport === 0 || !persistent}>
              {working ? "Importing…" : `Import ${toImport} project${toImport === 1 ? "" : "s"}`}
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-primary btn-sm" onClick={onClose} disabled={working}>
            Close
          </button>
        )
      }
    >
      {!persistent && (
        <div className="alert alert-warning" role="alert">
          Browser storage is not available, so projects cannot be imported into it.
        </div>
      )}

      {step.kind === "pick" && (
        <>
          <label htmlFor="project-file" className="form-label">
            Export file created by CodebaseXplorer
          </label>
          <input id="project-file" type="file" accept=".json,application/json" className="form-control" disabled={working || !persistent} onChange={(e) => pick(e.target.files?.[0])} />
          <div className="form-text">The file is checked completely before anything is saved. Malformed or inconsistent files are rejected.</div>
        </>
      )}

      {error && (
        <div className="alert alert-danger mt-3" role="alert">
          <strong>Import failed.</strong> {error.message}
          {error.issues.length > 0 && (
            <ul className="mb-0 mt-2 small">
              {error.issues.map((i) => (
                <li key={i} className="mono">
                  {i}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {step.kind === "review" && (
        <>
          <p className="text-muted small">
            Exported {new Date(step.parsed.exportedAt).toLocaleString()} by {step.parsed.app.name} {step.parsed.app.version} (format v{step.parsed.fromVersion}).
          </p>
          {step.parsed.warnings.map((w) => (
            <div key={w} className="alert alert-warning py-2" role="status">
              {w}
            </div>
          ))}
          {conflicts > 0 && (
            <div className="alert alert-info py-2" role="note">
              {conflicts} project{conflicts === 1 ? " already exists" : "s already exist"} in this browser. Nothing is overwritten unless you choose to replace it.
            </div>
          )}
          <div className="table-responsive">
            <table className="table table-sm align-middle">
              <caption className="visually-hidden">Projects in the file</caption>
              <thead>
                <tr>
                  <th scope="col">Project</th>
                  <th scope="col">Files</th>
                  <th scope="col">Size</th>
                  <th scope="col">What to do</th>
                </tr>
              </thead>
              <tbody>
                {step.parsed.candidates.map(({ project, existing }) => {
                  const id = project.meta.id;
                  return (
                    <tr key={id}>
                      <td>
                        <div className="fw-semibold">{project.meta.name}</div>
                        <div className="small text-muted mono">{id}</div>
                        {existing && <span className="chip">Exists: “{existing.name}”, saved {new Date(existing.updatedAt).toLocaleDateString()}</span>}
                        {project.docs.length > 0 && <span className="chip ms-1">{project.docs.length} doc(s)</span>}
                      </td>
                      <td>{project.meta.fileCount}</td>
                      <td>{formatBytes(project.meta.sourceBytes)}</td>
                      <td>
                        <label className="visually-hidden" htmlFor={`choice-${id}`}>
                          Action for {project.meta.name}
                        </label>
                        <select id={`choice-${id}`} className="form-select form-select-sm" value={choices[id]} onChange={(e) => setChoices({ ...choices, [id]: e.target.value as Resolution })}>
                          {existing ? (
                            <>
                              <option value="skip">Keep the existing one (skip)</option>
                              <option value="replace">Replace the existing one</option>
                              <option value="copy">Keep both (import as a copy)</option>
                            </>
                          ) : (
                            <>
                              <option value="replace">Import</option>
                              <option value="skip">Skip</option>
                            </>
                          )}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {step.kind === "done" && (
        <>
          <ul className="list-unstyled mb-2">
            {step.report.outcomes.map((o) => (
              <li key={o.id} className="mb-1">
                <span className={`evidence ${o.result === "failed" ? "uncertain" : o.result === "skipped" ? "inference" : "fact"} me-2`}>{RESULT_LABEL[o.result]}</span>
                {o.name}
                {o.message && <span className="text-muted"> — {o.message}</span>}
              </li>
            ))}
          </ul>
          {step.report.warnings.map((w) => (
            <div key={w} className="alert alert-warning py-2 mb-1" role="status">
              {w}
            </div>
          ))}
        </>
      )}
    </Modal>
  );
}
