"use client";

import { useEffect, useRef, useState } from "react";
import { useExplorer } from "@/context/ExplorerContext";

/**
 * Imports a repository from a ZIP archive or a local folder. Files are read and analyzed in the browser
 * (Web Worker); nothing is uploaded and nothing from the repository is ever executed.
 */
export function ImportModal({ onClose }: { onClose: () => void }) {
  const { importZip, importFolder, importState, clearImportError, limits, source, resetToDemo } = useExplorer();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<"zip" | "folder">("zip");
  const running = importState.status === "running";

  // Latest props/state for the mount-only key handler below (avoids re-running focus management on every render).
  const latest = useRef({ onClose, running });
  useEffect(() => {
    latest.current = { onClose, running };
  });

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>("input,button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !latest.current.running) latest.current.onClose();
      if (e.key === "Tab" && dialogRef.current) {
        const items = [...dialogRef.current.querySelectorAll<HTMLElement>("input,button")].filter((el) => !el.hasAttribute("disabled"));
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus();
      clearImportError();
    };
  }, [clearImportError]);

  const done = async (ok: Promise<boolean>) => {
    if (await ok) onClose();
  };

  return (
    <>
      <div className="modal-backdrop-cx" onClick={running ? undefined : onClose} aria-hidden="true" />
      <div className="modal d-block" role="dialog" aria-modal="true" aria-labelledby="import-title" ref={dialogRef}>
        <div className="modal-dialog modal-dialog-centered">
          <div className="modal-content">
            <div className="modal-header">
              <h2 className="modal-title fs-6" id="import-title">
                Import a repository
              </h2>
              <button type="button" className="btn-close" aria-label="Close" onClick={onClose} disabled={running} />
            </div>
            <div className="modal-body">
              <div className="btn-group btn-group-sm mb-3" role="group" aria-label="Import source">
                <button type="button" className={`btn ${tab === "zip" ? "btn-primary" : "btn-outline-primary"}`} aria-pressed={tab === "zip"} onClick={() => setTab("zip")} disabled={running}>
                  ZIP archive
                </button>
                <button type="button" className={`btn ${tab === "folder" ? "btn-primary" : "btn-outline-primary"}`} aria-pressed={tab === "folder"} onClick={() => setTab("folder")} disabled={running}>
                  Local folder
                </button>
              </div>

              {tab === "zip" ? (
                <>
                  <label htmlFor="zip-input" className="form-label">
                    ZIP archive (up to {(limits.maxArchiveBytes / 1048576).toFixed(0)} MB)
                  </label>
                  <input id="zip-input" type="file" accept=".zip,application/zip" className="form-control" disabled={running} onChange={(e) => e.target.files?.[0] && done(importZip(e.target.files[0]))} />
                </>
              ) : (
                <>
                  <label htmlFor="folder-input" className="form-label">
                    Project folder
                  </label>
                  <input
                    id="folder-input"
                    type="file"
                    className="form-control"
                    disabled={running}
                    // @ts-expect-error webkitdirectory is a non-standard but widely supported attribute
                    webkitdirectory=""
                    multiple
                    onChange={(e) => e.target.files && e.target.files.length > 0 && done(importFolder([...e.target.files]))}
                  />
                  <div className="form-text">Your browser will ask for permission to read the folder. Files stay on your computer.</div>
                </>
              )}
              <div className="form-text mt-2">
                node_modules, .git, build output, lock files and binaries are skipped automatically, and .gitignore is respected. Everything skipped is listed in the dashboard. Nothing from the repository is ever executed.
              </div>

              {running && importState.status === "running" && (
                <div className="mt-3" role="status" aria-live="polite">
                  <div className="d-flex justify-content-between small text-muted">
                    <span>{importState.stage}…</span>
                    {importState.total > 1 && <span>{Math.round((importState.done / importState.total) * 100)}%</span>}
                  </div>
                  <div className="progress" style={{ height: 6 }}>
                    <div className="progress-bar progress-bar-striped progress-bar-animated" style={{ width: importState.total > 1 ? `${(importState.done / importState.total) * 100}%` : "100%" }} />
                  </div>
                </div>
              )}
              {importState.status === "error" && (
                <div className="alert alert-danger mt-3 mb-0" role="alert">
                  <strong>Import failed.</strong> {importState.message}
                </div>
              )}
            </div>
            <div className="modal-footer justify-content-between">
              {source === "imported" ? (
                <button type="button" className="btn btn-outline-secondary btn-sm" disabled={running} onClick={() => { resetToDemo(); onClose(); }}>
                  Back to demo project
                </button>
              ) : (
                <span />
              )}
              <button type="button" className="btn btn-primary btn-sm" onClick={onClose} disabled={running}>
                Close
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
