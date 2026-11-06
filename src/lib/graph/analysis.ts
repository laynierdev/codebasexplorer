import type { ApiEndpoint, ImpactResult, Layer, Repository } from "@/domain/types";

/** Pure graph helpers over a Repository. No React, no I/O. */

export interface GraphIndex {
  outgoing: Map<string, string[]>;
  incoming: Map<string, string[]>;
}

export function buildGraphIndex(repo: Repository): GraphIndex {
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const f of repo.files) {
    outgoing.set(f.path, []);
    incoming.set(f.path, []);
  }
  for (const d of repo.dependencies) {
    if (!outgoing.get(d.from)?.includes(d.to)) outgoing.get(d.from)?.push(d.to);
    if (!incoming.get(d.to)?.includes(d.from)) incoming.get(d.to)?.push(d.from);
  }
  return { outgoing, incoming };
}

export function layerOf(path: string): Layer {
  if (path === "src/server.ts" || path === "src/app.ts") return "entry";
  if (path.startsWith("src/routes/")) return "route";
  if (path.startsWith("src/controllers/")) return "controller";
  if (path.startsWith("src/services/")) return "service";
  if (path.startsWith("src/repositories/")) return "repository";
  if (path.startsWith("src/db/")) return "database";
  if (path.startsWith("src/middleware/")) return "middleware";
  if (path.startsWith("src/config/")) return "config";
  if (path.startsWith("src/models/")) return "model";
  if (path.startsWith("tests/")) return "test";
  return "other";
}

export const LAYER_LABEL: Record<Layer, string> = {
  entry: "Entry",
  route: "Routes",
  controller: "Controllers",
  service: "Services",
  repository: "Repositories",
  database: "Database",
  middleware: "Middleware",
  config: "Config",
  model: "Models",
  test: "Tests",
  external: "External",
  other: "Other",
};

/** Tarjan's strongly connected components; returns only real cycles (size > 1). */
export function findCycles(repo: Repository): string[][] {
  const { outgoing } = buildGraphIndex(repo);
  let counter = 0;
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const cycles: string[][] = [];

  const visit = (v: string) => {
    index.set(v, counter);
    low.set(v, counter);
    counter++;
    stack.push(v);
    onStack.add(v);
    for (const w of outgoing.get(v) ?? []) {
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v) ?? 0, low.get(w) ?? 0));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v) ?? 0, index.get(w) ?? 0));
      }
    }
    if (low.get(v) === index.get(v)) {
      const component: string[] = [];
      let w: string | undefined;
      do {
        w = stack.pop();
        if (w === undefined) break;
        onStack.delete(w);
        component.push(w);
      } while (w !== v);
      if (component.length > 1) cycles.push(component.sort());
    }
  };

  for (const f of repo.files) if (!index.has(f.path)) visit(f.path);
  return cycles;
}

function reach(start: string, edges: Map<string, string[]>): string[] {
  const seen = new Set<string>();
  const queue = [start];
  while (queue.length) {
    const current = queue.shift() as string;
    for (const next of edges.get(current) ?? []) {
      if (!seen.has(next) && next !== start) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return [...seen].sort();
}

/**
 * Confirmed impact derived from static imports. Anything else (dynamic use, runtime
 * wiring, API consumers outside the repo) is NOT detected — callers must say so.
 */
export function computeImpact(repo: Repository, target: string): ImpactResult {
  const index = buildGraphIndex(repo);
  const direct = [...(index.incoming.get(target) ?? [])].sort();
  const all = reach(target, index.incoming);
  const transitive = all.filter((p) => !direct.includes(p));
  const affectedTests = all.filter((p) => layerOf(p) === "test");
  const affectedFiles = new Set([target, ...all]);
  const affectedRoutes: ApiEndpoint[] = repo.endpoints.filter((e) => affectedFiles.has(e.file));
  const cycles = findCycles(repo).filter((c) => c.includes(target));
  return {
    target,
    directDependents: direct,
    transitiveDependents: transitive,
    affectedTests,
    affectedRoutes,
    dependencies: reach(target, index.outgoing),
    cycles,
  };
}

/** Endpoints reachable (via imports) from a given handler/controller/service file. */
export function endpointsServedBy(repo: Repository, file: string): ApiEndpoint[] {
  const index = buildGraphIndex(repo);
  const upstream = new Set([file, ...reach(file, index.incoming)]);
  return repo.endpoints.filter((e) => upstream.has(e.file));
}

export interface LayerViolation {
  from: string;
  to: string;
  message: string;
}

/** Imports that go against the intended routes → controllers → services → repositories layering. */
export function findLayerViolations(repo: Repository): LayerViolation[] {
  const violations: LayerViolation[] = [];
  for (const d of repo.dependencies) {
    const a = layerOf(d.from);
    const b = layerOf(d.to);
    if (a === "service" && b === "middleware") {
      violations.push({ from: d.from, to: d.to, message: "Service imports from the HTTP middleware layer." });
    }
    if (a === "middleware" && b === "service") {
      violations.push({ from: d.from, to: d.to, message: "Middleware depends on a service (acceptable, but couples HTTP to business logic)." });
    }
  }
  return violations;
}
