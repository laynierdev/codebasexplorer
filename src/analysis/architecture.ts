import type { ArchEdge, ArchNode, Layer, Repository } from "@/domain/types";
import { EXTERNAL_SYSTEMS } from "./technologies";

export interface ArchitectureGraph {
  nodes: ArchNode[];
  edges: ArchEdge[];
  /** Number of nodes left out to keep the graph readable (lowest-connected files first). */
  omitted: number;
}

/** Maximum nodes in the file-level graph; larger repositories should use the module view or filters. */
export const MAX_FILE_GRAPH_NODES = 250;

/**
 * File-level architecture graph derived from imports and external-package usage.
 * Edges to model/type files and test files are left out (they connect to everything and drown the signal).
 * Isolated files are omitted.
 */
export function buildFileGraph(repo: Repository, maxNodes = MAX_FILE_GRAPH_NODES): ArchitectureGraph {
  const candidates = new Map<string, ArchNode>();
  for (const f of repo.files) {
    if (!f.parsed || f.layer === "test" || f.layer === "model") continue;
    candidates.set(f.path, { id: f.path, label: f.name, layer: f.layer, file: f.path, description: f.purpose });
  }

  const edges: ArchEdge[] = [];
  const edgeIds = new Set<string>();
  for (const d of repo.dependencies) {
    if (!candidates.has(d.from) || !candidates.has(d.to) || d.from === d.to) continue;
    const id = `${d.from}->${d.to}`;
    if (edgeIds.has(id)) continue;
    edgeIds.add(id);
    edges.push({ id, source: d.from, target: d.to, evidence: "static" });
  }

  const externalNodes = new Map<string, ArchNode>();
  for (const u of repo.externalUsages) {
    if (!candidates.has(u.file)) continue;
    const system = EXTERNAL_SYSTEMS.find((s) => s.packages.includes(u.package));
    if (!system) continue;
    if (!externalNodes.has(system.id)) externalNodes.set(system.id, { id: system.id, label: system.label, layer: "external", description: system.description });
    const id = `${u.file}->${system.id}`;
    if (edgeIds.has(id)) continue;
    edgeIds.add(id);
    edges.push({ id, source: u.file, target: system.id, label: u.package, evidence: "declared" });
  }

  // Keep only connected nodes; trim to the most connected if there are too many.
  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }
  const all = [...candidates.values(), ...externalNodes.values()].filter((n) => (degree.get(n.id) ?? 0) > 0);
  const kept = all.length > maxNodes ? [...all].sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0)).slice(0, maxNodes) : all;
  const keptIds = new Set(kept.map((n) => n.id));
  return {
    nodes: kept,
    edges: edges.filter((e) => keptIds.has(e.source) && keptIds.has(e.target)),
    omitted: all.length - kept.length,
  };
}

/**
 * Module-level view: one node per source directory (module), colored by its dominant layer, with
 * edges weighted by the number of imports between directories. External systems hang off the modules using them.
 * Test and model-only modules are left out, like in the file view.
 */
export function buildModuleGraph(repo: Repository): ArchitectureGraph {
  const modules = repo.modules.filter((m) => m.layer !== "test" && m.layer !== "model");
  const byId = new Map(modules.map((m) => [m.id, m]));
  const edges: ArchEdge[] = [];
  for (const d of repo.moduleDependencies) {
    if (!byId.has(d.from) || !byId.has(d.to)) continue;
    edges.push({ id: `module:${d.from}->module:${d.to}`, source: `module:${d.from}`, target: `module:${d.to}`, label: String(d.count), evidence: "static" });
  }

  const moduleOfFile = new Map(repo.files.map((f) => [f.path, f.dir === "" ? "." : f.dir]));
  const externalNodes = new Map<string, ArchNode>();
  const externalEdges = new Map<string, Set<string>>();
  for (const u of repo.externalUsages) {
    const moduleId = moduleOfFile.get(u.file);
    const system = EXTERNAL_SYSTEMS.find((s) => s.packages.includes(u.package));
    if (!moduleId || !system || !byId.has(moduleId)) continue;
    externalNodes.set(system.id, { id: system.id, label: system.label, layer: "external", description: system.description });
    const key = `module:${moduleId}->${system.id}`;
    externalEdges.set(key, (externalEdges.get(key) ?? new Set()).add(u.package));
  }
  for (const [key, packages] of externalEdges) {
    const [source, target] = key.split("->") as [string, string];
    edges.push({ id: key, source, target, label: [...packages].join(", "), evidence: "declared" });
  }

  const connected = new Set(edges.flatMap((e) => [e.source, e.target]));
  const nodes: ArchNode[] = [
    ...modules
      .filter((m) => connected.has(`module:${m.id}`))
      .map((m) => ({ id: `module:${m.id}`, label: m.path || "(root)", layer: m.layer, description: `${m.fileCount} file(s), ${m.lineCount} lines` })),
    ...externalNodes.values(),
  ];
  return { nodes, edges, omitted: 0 };
}

/** The selected file plus its direct importers and imports (including models and tests). */
export function buildNeighborhood(repo: Repository, path: string): ArchitectureGraph {
  const ids = new Set<string>([path]);
  const edges: ArchEdge[] = [];
  const edgeIds = new Set<string>();
  for (const d of repo.dependencies) {
    if (d.from !== path && d.to !== path) continue;
    ids.add(d.from);
    ids.add(d.to);
    const id = `${d.from}->${d.to}`;
    if (!edgeIds.has(id)) {
      edgeIds.add(id);
      edges.push({ id, source: d.from, target: d.to, evidence: "static" });
    }
  }
  const byPath = new Map(repo.files.map((f) => [f.path, f]));
  const nodes: ArchNode[] = [...ids].flatMap((id) => {
    const f = byPath.get(id);
    return f ? [{ id, label: f.name, layer: f.layer, file: id, description: f.purpose }] : [];
  });
  return { nodes, edges, omitted: 0 };
}
