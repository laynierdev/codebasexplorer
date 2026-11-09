"use client";

import { useState } from "react";
import { formatBytes } from "@/analysis/ignore";
import { useExplorer } from "@/context/ExplorerContext";
import { useProjects } from "@/context/ProjectsContext";
import { Modal } from "@/components/ui/Modal";
import { sourceBytes } from "@/persistence/projects";

/** Explains exactly what saving stores, and where, before anything is written. */
export function SaveProjectDialog({ onClose }: { onClose: () => void }) {
  const { repo } = useExplorer();
  const { saveCurrent, settings, busy, error, persistent, storageNotice, clearError } = useProjects();
  const [autoSave, setAutoSave] = useState(settings.autoSave);

  const save = async () => {
    clearError();
    if (await saveCurrent({ acceptConsent: true, autoSave })) onClose();
  };

  return (
    <Modal
      title={`Save “${repo.name}” in this browser?`}
      onClose={onClose}
      locked={busy}
      footer={
        <>
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={onClose} disabled={busy}>
            Not now
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={busy || !persistent}>
            {busy ? "Saving…" : "Save project"}
          </button>
        </>
      }
    >
      {!persistent && (
        <div className="alert alert-warning" role="alert">
          Browser storage is not available, so saving is disabled. {storageNotice} You can still export the project as a JSON file.
        </div>
      )}
      <p className="mb-2">Saving keeps this project so you can reopen it later without importing it again. Please check what is stored:</p>
      <ul>
        <li>
          <strong>The analysis result and the full text of the {repo.analysis.analyzedFiles} analyzed source files</strong> (about {formatBytes(sourceBytes(repo))}). Source code can be sensitive, so this is stated clearly.
        </li>
        <li>AI-written documentation you generate for this project.</li>
        <li>
          <strong>Where:</strong> the IndexedDB of this browser on this device only. It is never uploaded. (When you use AI features, only short excerpts relevant to your question are sent to the AI service.)
        </li>
        <li>
          <strong>Control:</strong> delete one project or everything at any time from <em>Projects</em> or <em>Settings</em>, and export a JSON backup whenever you like.
        </li>
      </ul>
      <p className="small text-muted">Avoid saving confidential code on a shared or public computer.</p>
      <div className="form-check">
        <input id="autosave" type="checkbox" className="form-check-input" checked={autoSave} onChange={(e) => setAutoSave(e.target.checked)} />
        <label htmlFor="autosave" className="form-check-label">
          Save new imports automatically from now on (you can turn this off in Settings)
        </label>
      </div>
      {error && (
        <div className="alert alert-danger mt-3 mb-0" role="alert">
          {error}
        </div>
      )}
    </Modal>
  );
}
