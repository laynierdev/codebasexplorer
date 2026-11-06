"use client";

import { useMemo, useState } from "react";
import { useExplorer } from "@/context/ExplorerContext";
import { generateDocs } from "@/lib/docs";
import { PageHeader } from "@/components/ui/primitives";

function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function DocsPage() {
  const { repo } = useExplorer();
  const sections = useMemo(() => generateDocs(repo), [repo]);
  const [id, setId] = useState(sections[0]?.id ?? "");
  const [copied, setCopied] = useState(false);
  const current = sections.find((s) => s.id === id);

  const copy = async () => {
    if (!current) return;
    try {
      await navigator.clipboard.writeText(current.markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Documentation"
        subtitle="Generated from analyzed facts of the repository. Export as Markdown."
        actions={
          <button type="button" className="btn btn-primary btn-sm" onClick={() => download(`${repo.name}-docs.md`, sections.map((s) => s.markdown).join("\n\n---\n\n"))}>
            <i className="bi bi-download me-1" aria-hidden="true" />
            Export all (.md)
          </button>
        }
      />
      <div className="row g-3">
        <div className="col-lg-3">
          <div className="cx-card">
            <h2 className="cx-card-title">Sections</h2>
            <ul className="list-unstyled m-0">
              {sections.map((s) => (
                <li key={s.id}>
                  <button type="button" className={`tree-row ${id === s.id ? "selected" : ""}`} style={{ padding: "8px 12px" }} aria-current={id === s.id} onClick={() => setId(s.id)}>
                    {s.title}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="col-lg-9">
          {current && (
            <>
              <div className="d-flex gap-2 mb-2">
                <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => download(`${repo.name}-${current.id}.md`, current.markdown)}>
                  Export section
                </button>
                <button type="button" className="btn btn-sm btn-outline-secondary" onClick={copy}>
                  {copied ? "Copied" : "Copy Markdown"}
                </button>
                <span className="chip ms-auto">Template-generated (mock AI prose arrives in Stage 3)</span>
              </div>
              <pre className="doc-preview" aria-label={`${current.title} Markdown`}>
                {current.markdown}
              </pre>
            </>
          )}
        </div>
      </div>
    </>
  );
}
