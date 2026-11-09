"use client";

import { useEffect, useState } from "react";
import { useExplorer } from "@/context/ExplorerContext";
import { Modal } from "@/components/ui/Modal";

/**
 * Imports a repository from a ZIP archive or a local folder. Files are read and analyzed in the browser
 * (Web Worker); nothing is uploaded and nothing from the repository is ever executed.
 */
export function ImportModal({ onClose }: { onClose: () => void }) {
  const { importZip, importFolder, importState, clearImportError, limits, source, resetToDemo } = useExplorer();
  const [tab, setTab] = useState<"zip" | "folder">("zip");
  const running = importState.status === "running";

  // Do not leave an old error behind when the dialog closes.
  useEffect(() => clearImportError, [clearImportError]);

  const done = async (ok: Promise<boolean>) => {
    if (await ok) onClose();
  };

  return (
    <Modal
      title="Import a repository"
      onClose={onClose}
      locked={running}
      footer={
        <>
          {source === "imported" && (
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm me-auto"
              disabled={running}
              onClick={() => {
                resetToDemo();
                onClose();
              }}
            >
              Back to demo project
            </button>
          )}
          <button type="button" className="btn btn-primary btn-sm" onClick={onClose} disabled={running}>
            Close
          </button>
        </>
      }
    >
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

      {importState.status === "running" && (
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
    </Modal>
  );
}
