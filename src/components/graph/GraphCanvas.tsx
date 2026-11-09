"use client";

import "@xyflow/react/dist/style.css";
import { useEffect, useMemo, useRef } from "react";
import { Background, Controls, MarkerType, MiniMap, ReactFlow, type Edge, type Node, type ReactFlowInstance } from "@xyflow/react";
import type { ArchEdge } from "@/domain/types";
import type { PositionedNode } from "@/lib/graph/architecture";

interface Props {
  nodes: PositionedNode[];
  edges: ArchEdge[];
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  ariaLabel: string;
  showMiniMap?: boolean;
}

/** Thin presentational wrapper around React Flow. Receives already-computed positions. */
export function GraphCanvas({ nodes, edges, selectedId, onSelect, ariaLabel, showMiniMap = false }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const flowRef = useRef<ReactFlowInstance | null>(null);

  // Fit the graph to the container once it has its real size, and again whenever the container is resized.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => flowRef.current?.fitView({ padding: 0.08, maxZoom: 1.1, duration: 0 }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const neighbors = useMemo(() => {
    if (!selectedId) return null;
    const set = new Set<string>([selectedId]);
    for (const e of edges) {
      if (e.source === selectedId) set.add(e.target);
      if (e.target === selectedId) set.add(e.source);
    }
    return set;
  }, [edges, selectedId]);

  const rfNodes: Node[] = nodes.map((n) => ({
    id: n.id,
    position: { x: n.x, y: n.y },
    data: { label: n.label },
    className: `cx-node layer-${n.layer}${selectedId === n.id ? " selected" : ""}${neighbors && !neighbors.has(n.id) ? " dim" : ""}`,
    style: { width: n.width, height: n.height },
    draggable: true,
    connectable: false,
    ariaLabel: `${n.label}, ${n.layer}`,
  }));

  const rfEdges: Edge[] = edges.map((e) => {
    const active = !selectedId || e.source === selectedId || e.target === selectedId;
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.label,
      className: active ? "" : "dim",
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: "#8c959f" },
      style: { stroke: active && selectedId ? "#1f5fd6" : "#8c959f", strokeDasharray: e.evidence === "declared" ? "5 4" : undefined },
      labelStyle: { fontSize: 11, fill: "#59636e" },
    };
  });

  return (
    <div className="graph-wrap" role="group" aria-label={ariaLabel} ref={wrapRef}>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        fitView
        fitViewOptions={{ padding: 0.08, maxZoom: 1.1 }}
        onInit={(instance) => {
          flowRef.current = instance;
          requestAnimationFrame(() => instance.fitView({ padding: 0.08, maxZoom: 1.1, duration: 0 }));
        }}
        minZoom={0.2}
        maxZoom={2}
        nodesConnectable={false}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, node) => onSelect?.(node.id)}
        onPaneClick={() => onSelect?.(null)}
      >
        <Background gap={20} color="#e4e8ec" />
        <Controls showInteractive={false} />
        {showMiniMap && <MiniMap pannable zoomable ariaLabel="Graph overview" />}
      </ReactFlow>
    </div>
  );
}
