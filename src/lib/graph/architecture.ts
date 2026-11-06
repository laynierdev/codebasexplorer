import dagre from "@dagrejs/dagre";
import type { ArchNode } from "@/domain/types";
import type { ArchitectureGraph } from "@/analysis/architecture";

// Graph construction lives in the analysis layer; this module only lays graphs out for display.
export { buildFileGraph, buildModuleGraph, buildNeighborhood } from "@/analysis/architecture";
export type { ArchitectureGraph } from "@/analysis/architecture";

export interface PositionedNode extends ArchNode {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function layoutGraph(graph: Pick<ArchitectureGraph, "nodes" | "edges">, direction: "LR" | "TB" = "LR"): PositionedNode[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: direction, nodesep: 28, ranksep: 90, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));
  const width = 190;
  const height = 52;
  for (const n of graph.nodes) g.setNode(n.id, { width, height });
  for (const e of graph.edges) if (e.source !== e.target) g.setEdge(e.source, e.target);
  dagre.layout(g);
  return graph.nodes.map((n) => {
    const pos = g.node(n.id);
    return { ...n, x: pos.x - width / 2, y: pos.y - height / 2, width, height };
  });
}
