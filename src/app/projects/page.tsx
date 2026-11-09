"use client";

import { useState, type ReactNode } from "react";
import { formatBytes } from "@/analysis/ignore";
import { useExplorer } from "@/context/ExplorerContext";
import { useProjects } from "@/context/ProjectsContext";
import { ImportModal } from "@/components/layout/ImportModal";
import { ImportProjectsDialog } from "@/components/projects/ImportProjectsDialog";
import { SaveProjectDialog } from "@/components/projects/SaveProjectDialog";
import { Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/primitives";
import type { ProjectMeta } from "@/persistence/schemas";

type Dialog =
  | { kind: "import-source" }
  | { kind: "import-file" }
  | { kind: "save" }
  | { kind: "rename"; project: ProjectMeta }
  | { kind: "delete"; id: string; name: string }
  | { kind: "clear" };

const ORIGIN_LABEL = { zip: "ZIP", folder: "Folder", import: "Imported file" } as const;

export default function ProjectsPage() {
  const { repo, source, projectId, resetToDemo } = useExplorer();
  const p = useProjects();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const close = () => setDialog(null);

  const quotaPct = p.usage.usageBytes && p.usage.quotaBytes ? Math.min(100, (p.usage.usageBytes / p.usage.quotaBytes) * 100) : null;

  return (
    <>
      <PageHeader
        title="Projects"
        subtitle="Repositories you analyzed. Saved projects live only in this browser; export them to back up or move them."
        actions={
          <>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setDialog({ kind: "import-source" })}>
              <i className="bi bi-file-earmark-zip me-1" aria-hidden="true" />
              Analyze ZIP or folder
            </button>
            <button type="button" className="btn btn-outline-primary btn-sm" onClick={() => setDialog({ kind: "import-file" })}>
              <i className="bi bi-box-arrow-in-down me-1" aria-hidden="true" />
              Import saved projects (.json)
            </button>
            <button type="button" className="btn btn-outline-secondary btn-sm" disabled={p.projects.length === 0 || p.busy} onClick={() => p.exportProjects()}>
              <i className="bi bi-box-arrow-up me-1" aria-hidden="true" />
              Export all
            </button>
          </>
        }
      />

      {!p.persistent && p.ready && (
        <div className="alert alert-warning" role="alert">
          <strong>Browser storage is not available.</strong> {p.storageNotice} Projects will not survive a reload; use <em>Export</em> to keep them.
        </div>
      )}
      {p.error && (
        <div className="alert alert-danger d-flex justify-content-between" role="alert">
          <span>{p.error}</span>
          <button type="button" className="btn-close" aria-label="Dismiss" onClick={p.clearError} />
        </div>
      )}

      {p.canSave && (
        <div className="alert alert-info d-flex flex-wrap justify-content-between align-items-center gap-2" role="status">
          <span>
            <strong>{repo.name}</strong> is only in memory. Save it to reopen it later, or export it as a file.
          </span>
          <span className="d-flex gap-2">
            <button type="button" className="btn btn-sm btn-primary" disabled={!p.persistent} onClick={() => setDialog({ kind: "save" })}>
              Save in this browser…
            </button>
            <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => p.exportCurrent()}>
              Export
            </button>
          </span>
        </div>
      )}

      <div className="cx-card mb-3">
        <div className="table-responsive">
          <table className="table align-middle mb-0">
            <caption className="visually-hidden">Projects</caption>
            <thead>
              <tr>
                <th scope="col">Project</th>
                <th scope="col">Files</th>
                <th scope="col">Size</th>
                <th scope="col">Last opened</th>
                <th scope="col" className="text-end">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <div className="fw-semibold">acme-shop-api</div>
                  <span className="chip">Built-in demo</span>
                  {source === "demo" && <span className="chip ms-1">Open now</span>}
                </td>
                <td>30</td>
                <td>—</td>
                <td>—</td>
                <td className="text-end">
                  <button type="button" className="btn btn-sm btn-outline-primary" disabled={source === "demo"} onClick={resetToDemo}>
                    Open
                  </button>
                </td>
              </tr>
              {p.projects.map((m) => (
                <tr key={m.id}>
                  <td>
                    <div className="fw-semibold">{m.name}</div>
                    <div className="small text-muted">{m.description || m.languages.join(", ")}</div>
                    <span className="chip">{ORIGIN_LABEL[m.origin]}</span>
                    {m.id === projectId && <span className="chip ms-1">Open now</span>}
                  </td>
                  <td>
                    {m.fileCount}
                    <div className="small text-muted">{m.parsedFileCount} parsed</div>
                  </td>
                  <td>{formatBytes(m.sourceBytes)}</td>
                  <td>{new Date(m.lastOpenedAt).toLocaleString()}</td>
                  <td className="text-end text-nowrap">
                    <button type="button" className="btn btn-sm btn-primary me-1" disabled={p.busy || m.id === projectId} onClick={() => p.open(m.id)}>
                      Open
                    </button>
                    <button type="button" className="btn btn-sm btn-outline-secondary me-1" disabled={p.busy} onClick={() => p.exportProjects([m.id])} aria-label={`Export ${m.name}`} title="Export as JSON">
                      <i className="bi bi-box-arrow-up" aria-hidden="true" />
                    </button>
                    <button type="button" className="btn btn-sm btn-outline-secondary me-1" disabled={p.busy} onClick={() => setDialog({ kind: "rename", project: m })} aria-label={`Rename ${m.name}`} title="Rename">
                      <i className="bi bi-pencil" aria-hidden="true" />
                    </button>
                    <button type="button" className="btn btn-sm btn-outline-danger" disabled={p.busy} onClick={() => setDialog({ kind: "delete", id: m.id, name: m.name })} aria-label={`Delete ${m.name}`} title="Delete">
                      <i className="bi bi-trash" aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              ))}
              {p.ready && p.projects.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-muted">
                    No saved projects yet. Analyze a ZIP or folder, then save it, or import a project file.
                  </td>
                </tr>
              )}
              {p.damaged.map((id) => (
                <tr key={id} className="table-warning">
                  <td colSpan={4}>
                    <strong>Damaged record</strong> <span className="mono">{id}</span> could not be read (it may have been written by an incompatible version).
                  </td>
                  <td className="text-end">
                    <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => p.remove(id)} disabled={p.busy}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <section className="cx-card" aria-labelledby="h-storage">
        <h2 className="cx-card-title" id="h-storage">
          Browser storage
        </h2>
        <div className="cx-card-body">
          <p className="mb-2">
            Saved projects (analysis and source text) are kept in this browser&apos;s IndexedDB on this device. Nothing is uploaded.
            {p.usage.usageBytes !== undefined && ` This site currently uses ${formatBytes(p.usage.usageBytes)}${p.usage.quotaBytes ? ` of about ${formatBytes(p.usage.quotaBytes)} available` : ""}.`}
          </p>
          {quotaPct !== null && (
            <div className="progress mb-3" style={{ height: 6 }} role="img" aria-label={`Storage used: ${quotaPct.toFixed(1)}%`}>
              <div className="progress-bar" style={{ width: `${Math.max(quotaPct, 1)}%` }} />
            </div>
          )}
          <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => setDialog({ kind: "clear" })} disabled={p.busy || !p.persistent}>
            <i className="bi bi-trash me-1" aria-hidden="true" />
            Delete all saved data…
          </button>
        </div>
      </section>

      {dialog?.kind === "import-source" && <ImportModal onClose={close} />}
      {dialog?.kind === "import-file" && <ImportProjectsDialog onClose={close} />}
      {dialog?.kind === "save" && <SaveProjectDialog onClose={close} />}
      {dialog?.kind === "rename" && <RenameDialog project={dialog.project} onClose={close} />}
      {dialog?.kind === "delete" && (
        <ConfirmDialog
          title={`Delete “${dialog.name}”?`}
          confirmLabel="Delete project"
          onClose={close}
          onConfirm={async () => {
            if (await p.remove(dialog.id)) close();
          }}
        >
          This permanently removes the saved analysis, the stored source text and any documentation for this project from this browser. Export it first if you may need it again. This cannot be undone.
        </ConfirmDialog>
      )}
      {dialog?.kind === "clear" && (
        <ConfirmDialog
          title="Delete all saved data?"
          confirmLabel="Delete everything"
          onClose={close}
          onConfirm={async () => {
            if (await p.clearAll()) close();
          }}
        >
          This permanently removes all {p.projects.length} saved project(s), their stored source text, documentation and your saved settings from this browser. This cannot be undone.
        </ConfirmDialog>
      )}
    </>
  );
}

function ConfirmDialog({ title, confirmLabel, children, onClose, onConfirm }: { title: string; confirmLabel: string; children: ReactNode; onClose: () => void; onConfirm: () => Promise<void> }) {
  const { busy, error } = useProjects();
  return (
    <Modal
      title={title}
      onClose={onClose}
      locked={busy}
      footer={
        <>
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-danger btn-sm" onClick={onConfirm} disabled={busy}>
            {busy ? "Deleting…" : confirmLabel}
          </button>
        </>
      }
    >
      <p className="mb-0">{children}</p>
      {error && (
        <div className="alert alert-danger mt-3 mb-0" role="alert">
          {error}
        </div>
      )}
    </Modal>
  );
}

function RenameDialog({ project, onClose }: { project: ProjectMeta; onClose: () => void }) {
  const { rename, busy, error } = useProjects();
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const valid = name.trim().length > 0 && name.trim().length <= 120;

  return (
    <Modal
      title="Project details"
      onClose={onClose}
      locked={busy}
      footer={
        <>
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy || !valid}
            onClick={async () => {
              if (await rename(project.id, { name: name.trim(), description: description.trim().slice(0, 400) })) onClose();
            }}
          >
            Save
          </button>
        </>
      }
    >
      <div className="mb-3">
        <label htmlFor="project-name" className="form-label">
          Name
        </label>
        <input id="project-name" className="form-control" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} aria-invalid={!valid} />
      </div>
      <div>
        <label htmlFor="project-description" className="form-label">
          Description
        </label>
        <textarea id="project-description" className="form-control" rows={3} maxLength={400} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      {error && (
        <div className="alert alert-danger mt-3 mb-0" role="alert">
          {error}
        </div>
      )}
    </Modal>
  );
}
