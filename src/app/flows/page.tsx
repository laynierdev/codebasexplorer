"use client";

import { useState } from "react";
import { useExplorer } from "@/context/ExplorerContext";
import { excerpt, findSymbol, refForLines } from "@/lib/repo/refs";
import { EvidenceBadge, PageHeader } from "@/components/ui/primitives";

export default function FlowsPage() {
  const { repo, openFile, ask, setAssistantOpen } = useExplorer();
  const flows = repo.flows;
  const [flowId, setFlowId] = useState(flows[0]?.id ?? "");
  const [open, setOpen] = useState<Set<number>>(new Set());
  const flow = flows.find((f) => f.id === flowId) ?? flows[0];

  return (
    <>
      <PageHeader title="Execution flows" subtitle="Follow how a request travels through the code. Steps link to real source; inferred steps are labeled." />
      <div className="row g-3">
        <div className="col-lg-3">
          <div className="cx-card">
            <h2 className="cx-card-title">Detected flows</h2>
            <ul className="list-unstyled m-0">
              {flows.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    className={`tree-row ${flowId === f.id ? "selected" : ""}`}
                    style={{ padding: "10px 12px", flexDirection: "column", alignItems: "flex-start", gap: 2, whiteSpace: "normal" }}
                    aria-current={flowId === f.id}
                    onClick={() => {
                      setFlowId(f.id);
                      setOpen(new Set());
                    }}
                  >
                    <span>{f.title}</span>
                    <span className="mono text-muted fw-normal">{f.trigger}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="col-lg-9">
          {!flow && (
            <div className="cx-card">
              <div className="cx-card-body text-muted">
                No execution flows were detected. Flows are derived from API endpoints whose handlers could be resolved (Express-style routers and Next.js route files). This repository has{" "}
                {repo.endpoints.length} detected endpoint(s).
              </div>
            </div>
          )}
          {flow && (
            <div className="cx-card">
              <h2 className="cx-card-title">
                <span>
                  {flow.title} <span className="mono text-muted fw-normal ms-2">{flow.trigger}</span>
                </span>
                <button
                  type="button"
                  className="btn btn-sm btn-outline-primary"
                  onClick={() => {
                    setAssistantOpen(true);
                    ask(`Explain the request lifecycle: ${flow.title}`);
                  }}
                >
                  <i className="bi bi-stars me-1" aria-hidden="true" />
                  Ask AI to explain
                </button>
              </h2>
              <div className="cx-card-body">
                <p>{flow.summary}</p>
                <ol className="list-unstyled mb-0">
                  {flow.steps.map((s, i) => {
                    // Use the step's explicit lines when present; otherwise resolve them from the symbol.
                    const sym = s.startLine ? undefined : findSymbol(repo, s.file, s.symbol);
                    const start = s.startLine ?? sym?.startLine;
                    const end = s.endLine ?? sym?.endLine;
                    const ref = start && end ? refForLines(repo, s.file, start, end) : undefined;
                    const code = ref && open.has(i) ? excerpt(repo, ref) : undefined;
                    return (
                      <li key={i} className={`flow-step ${s.evidence}`}>
                        <span className="num" aria-hidden="true">
                          {i + 1}
                        </span>
                        <div className="d-flex flex-wrap align-items-center gap-2">
                          <strong>{s.title}</strong>
                          <EvidenceBadge kind={s.evidence} />
                        </div>
                        <div className="text-muted">{s.description}</div>
                        {ref ? (
                          <div className="d-flex align-items-center gap-2 mt-1">
                            <button type="button" className="link-btn" onClick={() => openFile(ref.file, { start: ref.startLine, end: ref.endLine })}>
                              {ref.file}:{ref.startLine}-{ref.endLine} · {s.symbol}
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm btn-light border py-0"
                              aria-expanded={open.has(i)}
                              onClick={() =>
                                setOpen((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(i)) next.delete(i);
                                  else next.add(i);
                                  return next;
                                })
                              }
                            >
                              {open.has(i) ? "Hide code" : "Show code"}
                            </button>
                          </div>
                        ) : (
                          <div className="text-danger small mt-1">Reference could not be validated against the repository.</div>
                        )}
                        {code !== undefined && <pre className="excerpt">{code}</pre>}
                      </li>
                    );
                  })}
                </ol>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
