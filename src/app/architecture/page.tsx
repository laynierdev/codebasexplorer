"use client";

import { useMemo, useState } from "react";
import type { Layer } from "@/domain/types";
import { useExplorer } from "@/context/ExplorerContext";
import { buildFileGraph, buildModuleGraph, layoutGraph } from "@/lib/graph/architecture";
import { LAYER_LABEL } from "@/lib/graph/analysis";
import { GraphCanvas } from "@/components/graph/GraphCanvas";
import { useIsNarrow } from "@/hooks/useIsNarrow";
import { LayerBadge, SourceLink } from "@/components/ui/primitives";

type View = "modules" | "files";

export default function ArchitecturePage() {
  const { repo, openFile, runTask, thinking } = useExplorer();
  const narrow = useIsNarrow();
  const [view, setView] = useState<View>("modules");
  const [hidden, setHidden] = useState<Set<Layer>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  /** Directory the file view is limited to (set by "Show files" on a module). */
  const [scope, setScope] = useState<string | null>(null);

  const full = useMemo(() => (view === "modules" ? buildModuleGraph(repo) : buildFileGraph(repo)), [repo, view]);
  const layers = useMemo(() => [...new Set(full.nodes.map((n) => n.layer))], [full]);

  const graph = useMemo(() => {
    const inScope = (n: { file?: string }) => !scope || (scope === "." ? !n.file?.includes("/") : n.file?.startsWith(scope + "/"));
    let nodes = full.nodes.filter((n) => !hidden.has(n.layer) && (n.layer === "external" || inScope(n)));
    if (scope) {
      // Keep external systems only when a file in scope uses them.
      const keptFiles = new Set(nodes.filter((n) => n.layer !== "external").map((n) => n.id));
      const used = new Set(full.edges.filter((e) => keptFiles.has(e.source)).map((e) => e.target));
      nodes = nodes.filter((n) => n.layer !== "external" || used.has(n.id));
    }
    const ids = new Set(nodes.map((n) => n.id));
    const edges = full.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
    return { nodes: layoutGraph({ nodes, edges }, narrow ? "TB" : "LR"), edges };
  }, [full, hidden, scope, narrow]);

  const selectedNode = full.nodes.find((n) => n.id === selected);
  const incoming = full.edges.filter((e) => e.target === selected);
  const outgoing = full.edges.filter((e) => e.source === selected);
  const nameOf = (id: string) => full.nodes.find((n) => n.id === id)?.label ?? id;

  const toggleLayer = (layer: Layer) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(layer)) next.delete(layer);
      else next.add(layer);
      return next;
    });

  const switchView = (v: View, scopeDir: string | null = null) => {
    setView(v);
    setSelected(null);
    setScope(scopeDir);
    setHidden(new Set());
  };

  return (
    <div className="d-flex flex-column h-100">
      <div className="d-flex flex-wrap align-items-center gap-3 px-3 py-2 bg-white border-bottom">
        <h1 className="h6 mb-0">Architecture</h1>
        <div className="btn-group btn-group-sm" role="group" aria-label="Graph level">
          <button type="button" className={`btn ${view === "modules" ? "btn-primary" : "btn-outline-primary"}`} aria-pressed={view === "modules"} onClick={() => switchView("modules")}>
            Modules
          </button>
          <button type="button" className={`btn ${view === "files" ? "btn-primary" : "btn-outline-primary"}`} aria-pressed={view === "files"} onClick={() => switchView("files")}>
            Files
          </button>
        </div>
        <div className="d-flex flex-wrap gap-1" role="group" aria-label="Filter by component type">
          {layers.map((l) => (
            <button key={l} type="button" className="chip" aria-pressed={!hidden.has(l)} onClick={() => toggleLayer(l)} style={{ opacity: hidden.has(l) ? 0.45 : 1 }}>
              <span className="layer-dot" style={{ background: `var(--layer-${l})` }} aria-hidden="true" />
              {LAYER_LABEL[l]}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-sm btn-outline-primary" disabled={thinking} onClick={() => runTask({ task: "architecture" }, "Explain the architecture of this repository")}>
          <i className="bi bi-stars me-1" aria-hidden="true" />
          Explain architecture
        </button>
        {scope !== null && (
          <span className="chip">
            Scope: <span className="mono">{scope === "." ? "(root)" : scope}</span>
            <button type="button" className="btn-close ms-1" style={{ fontSize: "0.55rem" }} aria-label="Clear scope" onClick={() => switchView("files")} />
          </span>
        )}
        <span className="text-muted small ms-auto">
          Solid edges: imports. Dashed: external integrations. Models, tests and unconnected files are omitted to reduce noise.
          {full.omitted > 0 && ` ${full.omitted} less-connected file(s) are hidden; use the Modules view or filters to explore them.`}
        </span>
      </div>

      <div className="arch-body">
        <div className="arch-graph">
          {graph.nodes.length ? (
            <GraphCanvas
              key={view + narrow + scope + [...hidden].join()}
              nodes={graph.nodes}
              edges={graph.edges}
              selectedId={selected}
              onSelect={setSelected}
              showMiniMap={view === "files"}
              ariaLabel="Architecture graph. Use the inspector to follow relationships."
            />
          ) : (
            <p className="p-4 text-muted">All component types are hidden. Re-enable a type above.</p>
          )}
        </div>

        <aside className="arch-inspector bg-white border-start p-3" aria-label="Node inspector">
          {selectedNode ? (
            <>
              <h2 className="h6 mono">{selectedNode.label}</h2>
              <LayerBadge layer={selectedNode.layer} />
              <p className="mt-2">{selectedNode.description}</p>
              {selectedNode.file && (
                <p>
                  <SourceLink file={selectedNode.file} />
                </p>
              )}
              <div className="d-flex gap-2 mb-3">
                {selectedNode.file && (
                  <button type="button" className="btn btn-sm btn-primary" onClick={() => openFile(selectedNode.file as string)}>
                    Open source
                  </button>
                )}
                {view === "modules" && (
                  <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => switchView("files", selectedNode.id.slice("module:".length))}>
                    Show files
                  </button>
                )}
              </div>
              <h3 className="h6">Depends on ({outgoing.length})</h3>
              <ul className="list-unstyled">
                {outgoing.map((e) => (
                  <li key={e.id}>
                    <button type="button" className="link-btn" onClick={() => setSelected(e.target)}>
                      {nameOf(e.target)}
                      {e.label && view === "modules" ? ` (${e.label} imports)` : ""}
                    </button>
                  </li>
                ))}
                {outgoing.length === 0 && <li className="text-muted">Nothing.</li>}
              </ul>
              <h3 className="h6">Used by ({incoming.length})</h3>
              <ul className="list-unstyled mb-0">
                {incoming.map((e) => (
                  <li key={e.id}>
                    <button type="button" className="link-btn" onClick={() => setSelected(e.source)}>
                      {nameOf(e.source)}
                    </button>
                  </li>
                ))}
                {incoming.length === 0 && <li className="text-muted">Nothing.</li>}
              </ul>
            </>
          ) : (
            <div className="text-muted">
              <h2 className="h6 text-body">Inspector</h2>
              <p>Select a node to see its details and follow its relationships. Scroll to zoom, drag to pan.</p>
              <p className="mb-0">The graph is derived from imports in the source. The AI explains it but never adds relationships.</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
