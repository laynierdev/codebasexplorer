import dagre from "@dagrejs/dagre";
import type { ArchEdge, ArchNode, Layer, Repository } from "@/domain/types";
import { LAYER_LABEL, layerOf } from "./analysis";

/** External systems detected from bare package imports found in the source. */
const EXTERNAL_SYSTEMS: Record<string, { id: string; label: string; layer: Layer; description: string }> = {
  pg: { id: "ext:postgres", label: "PostgreSQL", layer: "external", description: "Relational database accessed through the pg driver." },
  stripe: { id: "ext:stripe", label: "Stripe API", layer: "external", description: "Payment provider used to create payment intents." },
  nodemailer: { id: "ext:smtp", label: "SMTP server", layer: "external", description: "Outgoing mail server used by Nodemailer." },
};

export interface ArchitectureGraph {
  nodes: ArchNode[];
  edges: ArchEdge[];
}

/** File-level architecture graph, derived from imports. Edges to models are omitted as noise. */
export function buildFileGraph(repo: Repository): ArchitectureGraph {
  const nodes: ArchNode[] = [];
  const edges: ArchEdge[] = [];
  const included = new Set<string>();

  for (const f of repo.files) {
    if (!f.parsed) continue;
    const layer = layerOf(f.path);
    if (layer === "test" || layer === "model") continue;
    included.add(f.path);
    nodes.push({ id: f.path, label: f.name, layer, file: f.path, description: f.purpose });
  }

  for (const d of repo.dependencies) {
    if (!included.has(d.from) || !included.has(d.to)) continue;
    const id = d.from + "->" + d.to;
    if (!edges.some((e) => e.id === id)) edges.push({ id, source: d.from, target: d.to, evidence: "static" });
  }

  const externalAdded = new Set<string>();
  for (const f of repo.files) {
    if (!included.has(f.path)) continue;
    for (const m of f.content.matchAll(/from\s+'([^'.][^']*)'/g)) {
      const system = EXTERNAL_SYSTEMS[m[1] ?? ""];
      if (!system) continue;
      if (!externalAdded.has(system.id)) {
        externalAdded.add(system.id);
        nodes.push({ id: system.id, label: system.label, layer: system.layer, description: system.description });
      }
      edges.push({ id: f.path + "->" + system.id, source: f.path, target: system.id, label: m[1], evidence: "declared" });
    }
  }
  return { nodes, edges };
}

/** Module-level view: one node per layer, edges weighted by number of imports. */
export function buildModuleGraph(repo: Repository): ArchitectureGraph {
  const file = buildFileGraph(repo);
  const counts = new Map<Layer, number>();
  const nodes: ArchNode[] = [];
  const layerOfNode = (n: ArchNode): Layer => n.layer;
  for (const n of file.nodes) counts.set(layerOfNode(n), (counts.get(layerOfNode(n)) ?? 0) + 1);

  const byId = new Map(file.nodes.map((n) => [n.id, n]));
  for (const [layer, count] of counts) {
    nodes.push({
      id: "layer:" + layer,
      label: LAYER_LABEL[layer],
      layer,
      description: layer === "external" ? count + " external system(s)" : count + " file(s)",
    });
  }
  const weights = new Map<string, number>();
  for (const e of file.edges) {
    const s = byId.get(e.source)?.layer;
    const t = byId.get(e.target)?.layer;
    if (!s || !t || s === t) continue;
    const key = s + "->" + t;
    weights.set(key, (weights.get(key) ?? 0) + 1);
  }
  const edges: ArchEdge[] = [...weights.entries()].map(([key, w]) => {
    const [s, t] = key.split("->") as [string, string];
    return { id: "layer:" + key, source: "layer:" + s, target: "layer:" + t, label: String(w), evidence: "static" };
  });
  return { nodes, edges };
}

/** The selected file plus its direct importers and imports (including models and tests). */
export function buildNeighborhood(repo: Repository, path: string): ArchitectureGraph {
  const ids = new Set<string>([path]);
  const edges: ArchEdge[] = [];
  for (const d of repo.dependencies) {
    if (d.from === path || d.to === path) {
      ids.add(d.from);
      ids.add(d.to);
      const id = d.from + "->" + d.to;
      if (!edges.some((e) => e.id === id)) edges.push({ id, source: d.from, target: d.to, evidence: "static" });
    }
  }
  const nodes: ArchNode[] = [...ids].flatMap((id) => {
    const f = repo.files.find((x) => x.path === id);
    return f ? [{ id, label: f.name, layer: layerOf(id), file: id, description: f.purpose }] : [];
  });
  return { nodes, edges };
}

export interface PositionedNode extends ArchNode {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function layoutGraph(graph: ArchitectureGraph, direction: "LR" | "TB" = "LR"): PositionedNode[] {
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
