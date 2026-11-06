"use client";

import { useMemo, useState } from "react";
import type { Layer } from "@/domain/types";
import { useExplorer } from "@/context/ExplorerContext";
import { findCycles, LAYER_LABEL, layerOf, mostImported } from "@/lib/graph/analysis";
import { FileDetails } from "@/components/explorer/FileDetails";
import { PageHeader, SourceLink } from "@/components/ui/primitives";

type Tab = "files" | "modules" | "cycles" | "packages";

export default function DependenciesPage() {
  const { repo } = useExplorer();
  const [tab, setTab] = useState<Tab>("files");
  const [filter, setFilter] = useState("");
  const parsed = useMemo(() => repo.files.filter((f) => f.parsed), [repo]);
  // Start with the most depended-on file: the most informative place to begin.
  const [selected, setSelected] = useState(() => mostImported(repo) ?? parsed[0]?.path ?? "");

  const cycles = useMemo(() => findCycles(repo), [repo]);
  const cycleFiles = useMemo(() => new Set(cycles.flat()), [cycles]);

  const matrix = useMemo(() => {
    const counts = new Map<string, number>();
    const layers = new Set<Layer>();
    for (const d of repo.dependencies) {
      const a = layerOf(d.from);
      const b = layerOf(d.to);
      layers.add(a);
      layers.add(b);
      if (a !== b) counts.set(a + ">" + b, (counts.get(a + ">" + b) ?? 0) + 1);
    }
    return { counts, layers: [...layers] };
  }, [repo]);

  const visible = parsed.filter((f) => f.path.toLowerCase().includes(filter.trim().toLowerCase()));

  return (
    <>
      <PageHeader title="Dependencies" subtitle="Explore what each file depends on and what depends on it, at file, module and package level." />

      <div className="file-tabs mb-3 px-0" role="tablist" aria-label="Dependency views" style={{ background: "transparent" }}>
        {(
          [
            ["files", "Files"],
            ["modules", "Modules"],
            ["cycles", `Cycles (${cycles.length})`],
            ["packages", "Packages"],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={`file-tab${tab === id ? " active" : ""}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {tab === "files" && (
        <div className="row g-3">
          <div className="col-lg-4">
            <div className="cx-card">
              <div className="p-2 border-bottom">
                <label htmlFor="dep-filter" className="visually-hidden">
                  Filter files
                </label>
                <input id="dep-filter" className="form-control form-control-sm" placeholder="Filter files…" value={filter} onChange={(e) => setFilter(e.target.value)} />
              </div>
              <ul className="list-unstyled m-0" style={{ maxHeight: "40vh", overflow: "auto" }}>
                {visible.map((f) => (
                  <li key={f.path}>
                    <button
                      type="button"
                      className={`tree-row ${selected === f.path ? "selected" : ""}`}
                      aria-current={selected === f.path}
                      onClick={() => setSelected(f.path)}
                    >
                      <span className="layer-dot" style={{ background: `var(--layer-${layerOf(f.path)})` }} aria-hidden="true" />
                      <span className="mono">{f.path}</span>
                      {cycleFiles.has(f.path) && <i className="bi bi-arrow-repeat text-warning ms-auto" title="In a circular dependency" aria-label="In a circular dependency" />}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="col-lg-8">
            <div className="cx-card">
              <h2 className="cx-card-title">
                <span className="mono">{selected}</span>
                <SourceLink file={selected} label="Open source" />
              </h2>
              <div className="cx-card-body">
                <p className="text-muted">{repo.files.find((f) => f.path === selected)?.purpose}</p>
                {selected && <FileDetails repo={repo} path={selected} />}
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === "modules" && (
        <div className="cx-card">
          <h2 className="cx-card-title">Module dependencies (imports from row → column)</h2>
          <div className="cx-card-body table-responsive">
            <table className="table table-sm text-center align-middle mb-0">
              <caption className="visually-hidden">Number of imports between layers</caption>
              <thead>
                <tr>
                  <th scope="col" className="text-start">
                    From \ To
                  </th>
                  {matrix.layers.map((l) => (
                    <th scope="col" key={l}>
                      {LAYER_LABEL[l]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.layers.map((from) => (
                  <tr key={from}>
                    <th scope="row" className="text-start">
                      {LAYER_LABEL[from]}
                    </th>
                    {matrix.layers.map((to) => {
                      const n = matrix.counts.get(from + ">" + to) ?? 0;
                      return (
                        <td key={to} style={{ background: n ? `rgba(31,95,214,${Math.min(0.12 + n * 0.07, 0.6)})` : undefined }}>
                          {n || ""}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "cycles" && (
        <div className="cx-card">
          <h2 className="cx-card-title">Circular dependencies</h2>
          <div className="cx-card-body">
            {cycles.length === 0 ? (
              <p className="mb-0">No circular dependencies detected through static imports.</p>
            ) : (
              cycles.map((c) => (
                <div key={c.join()} className="mb-3">
                  <span className="evidence fact me-2">Fact</span>
                  {c.map((p, i) => (
                    <span key={p}>
                      {i > 0 && " ⇄ "}
                      <SourceLink file={p} />
                    </span>
                  ))}
                  <p className="text-muted mt-2 mb-0">
                    Each file imports the other. It works while the imports are only used inside functions, but it is fragile and makes the modules hard to test in isolation.
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {tab === "packages" && (
        <div className="cx-card">
          <h2 className="cx-card-title">External packages (from package.json)</h2>
          <div className="cx-card-body table-responsive">
            <table className="table table-sm mb-0">
              <caption className="visually-hidden">External packages</caption>
              <thead>
                <tr>
                  <th scope="col">Package</th>
                  <th scope="col">Version</th>
                  <th scope="col">Type</th>
                </tr>
              </thead>
              <tbody>
                {repo.externalDependencies.map((d) => (
                  <tr key={d.name}>
                    <td className="mono">{d.name}</td>
                    <td className="mono">{d.version}</td>
                    <td>{d.dev ? "dev" : "runtime"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
