"use client";

import { useMemo, useState } from "react";
import type { AssistantMeta } from "@/domain/types";
import { useExplorer } from "@/context/ExplorerContext";
import { generateDocs } from "@/lib/docs";
import { DOC_SECTIONS, type DocSection } from "@/ai/schemas";
import { formatRef, PageHeader } from "@/components/ui/primitives";

function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

interface AiDoc {
  markdown: string;
  meta: AssistantMeta;
}

export default function DocsPage() {
  const { repo, invokeAi, openFile, aiStatus } = useExplorer();
  const sections = useMemo(() => generateDocs(repo), [repo]);
  const [id, setId] = useState(sections[0]?.id ?? "");
  const [copied, setCopied] = useState(false);
  const [aiDocs, setAiDocs] = useState<Record<string, AiDoc>>({});
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = sections.find((s) => s.id === id);
  const ai = aiDocs[id];
  const shown = ai?.markdown ?? current?.markdown ?? "";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const generate = async () => {
    if (!DOC_SECTIONS.includes(id as DocSection)) return;
    setGenerating(true);
    setError(null);
    try {
      const outcome = await invokeAi({ task: "docs", section: id as DocSection });
      if (outcome.kind !== "docs") throw new Error("Unexpected result.");
      const body = outcome.doc.sections
        .map((s) => {
          const refs = s.refs.length ? "\n\n_Sources:_ " + s.refs.map((r) => "`" + formatRef(r) + "`").join(", ") : "";
          return `## ${s.heading}\n\n${s.markdown}${refs}`;
        })
        .join("\n\n");
      setAiDocs((prev) => ({ ...prev, [id]: { markdown: `# ${outcome.doc.title}\n\n${body}`, meta: outcome.meta } }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed.");
    } finally {
      setGenerating(false);
    }
  };

  const exportAll = () =>
    download(
      `${repo.name}-docs.md`,
      sections.map((s) => aiDocs[s.id]?.markdown ?? s.markdown).join("\n\n---\n\n"),
    );

  return (
    <>
      <PageHeader
        title="Documentation"
        subtitle="Generated from analyzed facts of the repository; optionally written up by the AI and checked against the source. Export as Markdown."
        actions={
          <button type="button" className="btn btn-primary btn-sm" onClick={exportAll}>
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
                    {aiDocs[s.id] && <i className="bi bi-stars ms-auto" title="AI-written version" aria-label="AI-written version" />}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="col-lg-9">
          {current && (
            <>
              <div className="d-flex flex-wrap gap-2 mb-2 align-items-center">
                <button type="button" className="btn btn-sm btn-primary" onClick={generate} disabled={generating}>
                  {generating ? <span className="spinner-border spinner-border-sm me-1" aria-hidden="true" /> : <i className="bi bi-stars me-1" aria-hidden="true" />}
                  {ai ? "Regenerate with AI" : "Write with AI"}
                </button>
                {ai && (
                  <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setAiDocs(({ [id]: _removed, ...rest }) => rest)}>
                    Back to template
                  </button>
                )}
                <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => download(`${repo.name}-${current.id}.md`, shown)}>
                  Export section
                </button>
                <button type="button" className="btn btn-sm btn-outline-secondary" onClick={copy}>
                  {copied ? "Copied" : "Copy Markdown"}
                </button>
                <span className="chip ms-auto">
                  {ai ? (ai.meta.provider === "gemini" ? `Written by Gemini (${ai.meta.model})` : "Mock provider draft") : `Template from analysis facts · AI: ${aiStatus?.provider === "gemini" ? "Gemini" : "mock"}`}
                </span>
              </div>
              {error && (
                <div className="alert alert-danger py-2" role="alert">
                  {error}
                </div>
              )}
              {ai?.meta.fallbackReason && (
                <div className="alert alert-warning py-2" role="status">
                  Gemini was unavailable ({ai.meta.fallbackReason}); this draft comes from the mock provider.
                </div>
              )}
              {ai && ai.meta.warnings.length > 0 && (
                <ul className="small text-muted ps-3">
                  {ai.meta.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}
              <pre className="doc-preview" aria-label={`${current.title} Markdown`}>
                {shown}
              </pre>
              {ai && <SourceLinks markdown={ai.markdown} onOpen={openFile} />}
            </>
          )}
        </div>
      </div>
    </>
  );
}

/** Clickable list of the verified file references found in an AI-written section. */
function SourceLinks({ markdown, onOpen }: { markdown: string; onOpen: (file: string, range: { start: number; end: number }) => void }) {
  const refs = [...new Set([...markdown.matchAll(/`([^`\s]+?):(\d+)(?:-(\d+))?`/g)].map((m) => `${m[1]}:${m[2]}-${m[3] ?? m[2]}`))];
  if (refs.length === 0) return null;
  return (
    <div className="mt-2 d-flex flex-wrap gap-1" aria-label="Verified sources">
      {refs.map((r) => {
        const [file, range] = r.split(":") as [string, string];
        const [a, b] = range.split("-").map(Number) as [number, number];
        return (
          <button key={r} type="button" className="chip mono" onClick={() => onOpen(file, { start: a, end: b })}>
            {r}
          </button>
        );
      })}
    </div>
  );
}
