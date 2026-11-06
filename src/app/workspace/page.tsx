"use client";

import { useState } from "react";
import { useExplorer } from "@/context/ExplorerContext";
import { getFile, getSymbols } from "@/lib/repo/refs";
import { FileTree } from "@/components/explorer/FileTree";
import { SourceViewer } from "@/components/explorer/SourceViewer";
import { FileDetails } from "@/components/explorer/FileDetails";
import { LocalGraph } from "@/components/explorer/LocalGraph";
import { LayerBadge } from "@/components/ui/primitives";
import { layerOf } from "@/lib/graph/analysis";

type Tab = "code" | "deps" | "graph";

export default function WorkspacePage() {
  const { repo, selectedFile, highlight, openFile, ask, setAssistantOpen } = useExplorer();
  const [tab, setTab] = useState<Tab>("code");
  const file = getFile(repo, selectedFile);
  const symbols = getSymbols(repo, selectedFile);

  return (
    <div className="workspace">
      <section className="workspace-tree" aria-label="File explorer">
        <FileTree root={repo.tree} selected={selectedFile} onSelect={(p) => openFile(p)} />
      </section>

      <section className="workspace-center" aria-label="File viewer">
        {file ? (
          <>
            <div className="file-head">
              <div className="d-flex flex-wrap align-items-center gap-2">
                <h1 className="h6 mono mb-0">{file.path}</h1>
                {file.parsed && <LayerBadge layer={layerOf(file.path)} />}
                <span className="chip">{file.language}</span>
                <span className="chip">{file.lineCount} lines</span>
                <span className="chip">{(file.size / 1024).toFixed(1)} KB</span>
                {!file.parsed && (
                  <span className="chip" title="Searchable as text, but symbols and dependencies are not extracted">
                    text only
                  </span>
                )}
                <button
                  type="button"
                  className="btn btn-sm btn-outline-primary ms-auto"
                  onClick={() => {
                    setAssistantOpen(true);
                    ask("Explain this file");
                  }}
                >
                  <i className="bi bi-stars me-1" aria-hidden="true" />
                  Explain this file
                </button>
              </div>
              <p className="mb-1 mt-2 text-muted">{file.purpose}</p>
              {symbols.length > 0 && (
                <div className="d-flex flex-wrap gap-1 align-items-center" aria-label="Symbols in this file">
                  <span className="small text-muted me-1">Symbols:</span>
                  {symbols.map((s) => (
                    <button
                      key={s.name + s.startLine}
                      type="button"
                      className="chip mono"
                      onClick={() => openFile(file.path, { start: s.startLine, end: s.endLine })}
                      title={`${s.kind}, lines ${s.startLine}-${s.endLine}`}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="file-tabs" role="tablist" aria-label="File views">
              {(
                [
                  ["code", "Code"],
                  ["deps", "Dependencies"],
                  ["graph", "Graph"],
                ] as [Tab, string][]
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  className={`file-tab${tab === id ? " active" : ""}`}
                  onClick={() => setTab(id)}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === "code" && <SourceViewer file={file} highlight={highlight} />}
            {tab === "deps" && (
              <div className="panel-pad">
                <FileDetails repo={repo} path={file.path} />
              </div>
            )}
            {tab === "graph" && (file.parsed ? <LocalGraph repo={repo} path={file.path} /> : <p className="panel-pad text-muted">No dependency graph for text-only files.</p>)}
          </>
        ) : (
          <p className="panel-pad text-muted">Select a file to inspect it.</p>
        )}
      </section>
    </div>
  );
}
