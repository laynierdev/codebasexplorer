"use client";

import { useMemo } from "react";
import type { Repository } from "@/domain/types";
import { buildGraphIndex, endpointsServedBy, findCycles, layerOf } from "@/lib/graph/analysis";
import { LayerBadge, SourceLink } from "@/components/ui/primitives";

/** Dependency details for one file: outgoing, incoming, endpoints and cycles. */
export function FileDetails({ repo, path }: { repo: Repository; path: string }) {
  const { outgoing, incoming, cycles, endpoints } = useMemo(() => {
    const index = buildGraphIndex(repo);
    return {
      outgoing: index.outgoing.get(path) ?? [],
      incoming: index.incoming.get(path) ?? [],
      cycles: findCycles(repo).filter((c) => c.includes(path)),
      endpoints: endpointsServedBy(repo, path),
    };
  }, [repo, path]);

  const list = (files: string[], empty: string) =>
    files.length ? (
      <ul className="list-unstyled mb-0 d-flex flex-column gap-1">
        {files.map((f) => (
          <li key={f}>
            <SourceLink file={f} />
          </li>
        ))}
      </ul>
    ) : (
      <p className="text-muted mb-0">{empty}</p>
    );

  return (
    <div className="row g-3">
      <div className="col-md-6">
        <h2 className="h6">Depends on ({outgoing.length})</h2>
        {list(outgoing, "No imports of other project files.")}
      </div>
      <div className="col-md-6">
        <h2 className="h6">Depended on by ({incoming.length})</h2>
        {list(incoming, "No project file imports this file.")}
      </div>
      <div className="col-12">
        <h2 className="h6">Role</h2>
        <div className="d-flex gap-2 align-items-center">
          <LayerBadge layer={layerOf(path)} />
          <span className="text-muted">Layer inferred from the directory structure.</span>
        </div>
      </div>
      {endpoints.length > 0 && (
        <div className="col-12">
          <h2 className="h6">Endpoints that reach this file (via imports)</h2>
          <div className="d-flex flex-wrap gap-1">
            {endpoints.map((e) => (
              <span key={e.method + e.path} className="chip mono">
                {e.method} {e.path}
              </span>
            ))}
          </div>
        </div>
      )}
      {cycles.length > 0 && (
        <div className="col-12">
          <div className="alert alert-warning mb-0" role="note">
            <strong>Circular dependency:</strong> {cycles.map((c) => c.join(" ⇄ ")).join("; ")}
          </div>
        </div>
      )}
    </div>
  );
}
