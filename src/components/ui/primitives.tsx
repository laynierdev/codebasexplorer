"use client";

import type { ReactNode } from "react";
import type { ClaimKind, Layer, SourceRef } from "@/domain/types";
import { useExplorer } from "@/context/ExplorerContext";
import { LAYER_LABEL } from "@/lib/graph/analysis";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-3">
      <div>
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-sub mb-0">{subtitle}</p>}
      </div>
      {actions && <div className="d-flex gap-2 flex-wrap">{actions}</div>}
    </div>
  );
}

export function LayerBadge({ layer }: { layer: Layer }) {
  return (
    <span className="chip">
      <span className="layer-dot" style={{ background: `var(--layer-${layer})` }} aria-hidden="true" />
      {LAYER_LABEL[layer]}
    </span>
  );
}

const EVIDENCE_LABEL: Record<string, string> = {
  fact: "Fact",
  inference: "Inference",
  recommendation: "Recommendation",
  uncertain: "Uncertain",
  verified: "Verified",
  inferred: "Inference",
};

export function EvidenceBadge({ kind }: { kind: ClaimKind | "verified" | "inferred" }) {
  return <span className={`evidence ${kind}`}>{EVIDENCE_LABEL[kind]}</span>;
}

export function formatRef(ref: SourceRef): string {
  return ref.startLine === ref.endLine ? `${ref.file}:${ref.startLine}` : `${ref.file}:${ref.startLine}-${ref.endLine}`;
}

/** Link that opens the source viewer at a file/line range. */
export function SourceLink({ file, start, end, label }: { file: string; start?: number; end?: number; label?: string }) {
  const { openFile } = useExplorer();
  const range = start ? { start, end: end ?? start } : undefined;
  const text = label ?? (start ? (end && end !== start ? `${file}:${start}-${end}` : `${file}:${start}`) : file);
  return (
    <button type="button" className="link-btn" onClick={() => openFile(file, range)} title="Open in source viewer">
      {text}
    </button>
  );
}

export function FileList({ files, empty }: { files: string[]; empty: string }) {
  if (files.length === 0) return <p className="text-muted mb-0">{empty}</p>;
  return (
    <ul className="list-unstyled mb-0 d-flex flex-column gap-1">
      {files.map((f) => (
        <li key={f}>
          <SourceLink file={f} />
        </li>
      ))}
    </ul>
  );
}
