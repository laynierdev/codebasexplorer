"use client";

import { useEffect, useRef, useState } from "react";

const MAX_ARCHIVE_MB = 50;

/**
 * Stage 1: validates the chosen file client-side and explains that real analysis
 * arrives in Stage 2. The uploaded file is read for name/size only and never opened or executed.
 */
export function ImportModal({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>("input,button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
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
    };
  }, [onClose]);

  const onFile = (file: File | undefined) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".zip")) {
      setMessage({ kind: "error", text: "Only .zip archives are supported." });
      return;
    }
    const mb = file.size / (1024 * 1024);
    if (mb > MAX_ARCHIVE_MB) {
      setMessage({ kind: "error", text: `Archive is ${mb.toFixed(1)} MB; the limit is ${MAX_ARCHIVE_MB} MB (configurable in Settings).` });
      return;
    }
    setMessage({
      kind: "ok",
      text: `“${file.name}” (${mb.toFixed(1)} MB) passed the basic checks. Safe extraction and analysis arrive in Stage 2; this prototype only shows the demo repository.`,
    });
  };

  return (
    <>
      <div className="modal-backdrop-cx" onClick={onClose} aria-hidden="true" />
      <div className="modal d-block" role="dialog" aria-modal="true" aria-labelledby="import-title" ref={dialogRef}>
        <div className="modal-dialog modal-dialog-centered">
          <div className="modal-content">
            <div className="modal-header">
              <h2 className="modal-title fs-6" id="import-title">
                Import a repository
              </h2>
              <button type="button" className="btn-close" aria-label="Close" onClick={onClose} />
            </div>
            <div className="modal-body">
              <label htmlFor="zip-input" className="form-label">
                ZIP archive
              </label>
              <input id="zip-input" type="file" accept=".zip,application/zip" className="form-control" onChange={(e) => onFile(e.target.files?.[0])} />
              <div className="form-text">
                Dependencies (node_modules), .git and build output are ignored automatically. Nothing from the archive is ever executed.
              </div>
              {message && (
                <div className={`alert mt-3 mb-0 ${message.kind === "ok" ? "alert-info" : "alert-danger"}`} role="alert">
                  {message.text}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-primary btn-sm" onClick={onClose}>
                Close
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
