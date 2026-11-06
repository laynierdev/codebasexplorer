"use client";

import { useMemo } from "react";
import type { Repository } from "@/domain/types";
import { buildNeighborhood, layoutGraph } from "@/lib/graph/architecture";
import { useExplorer } from "@/context/ExplorerContext";
import { GraphCanvas } from "@/components/graph/GraphCanvas";

/** Neighborhood graph of the selected file: direct imports and importers. */
export function LocalGraph({ repo, path }: { repo: Repository; path: string }) {
  const { openFile } = useExplorer();
  const { nodes, edges } = useMemo(() => {
    const g = buildNeighborhood(repo, path);
    return { nodes: layoutGraph(g, "LR"), edges: g.edges };
  }, [repo, path]);

  return (
    <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
      <GraphCanvas
        key={path}
        nodes={nodes}
        edges={edges}
        selectedId={path}
        ariaLabel={`Dependency neighborhood of ${path}. Click a node to open its source.`}
        onSelect={(id) => {
          if (id && id !== path) openFile(id);
        }}
      />
    </div>
  );
}
