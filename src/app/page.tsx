"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useExplorer } from "@/context/ExplorerContext";
import { buildGraphIndex, findCycles, findLayerViolations, LAYER_LABEL, layerOf } from "@/lib/graph/analysis";
import { getFile } from "@/lib/repo/refs";
import { PageHeader, SourceLink } from "@/components/ui/primitives";
import { EXTERNAL_SYSTEMS } from "@/analysis/technologies";
import type { Layer } from "@/domain/types";

const REASON_LABEL: Record<string, string> = {
  "ignored-directory": "Ignored directory",
  "ignored-pattern": "Ignored pattern",
  gitignore: ".gitignore",
  binary: "Binary file",
  "too-large": "Too large",
  "over-file-limit": "Over file limit",
  undecodable: "Not decodable",
};

export default function DashboardPage() {
  const { repo, ask, setAssistantOpen, openFile } = useExplorer();

  const data = useMemo(() => {
    const index = buildGraphIndex(repo);
    const modules = new Map<Layer, number>();
    for (const f of repo.files) {
      if (!f.parsed) continue;
      const l = layerOf(f.path);
      modules.set(l, (modules.get(l) ?? 0) + 1);
    }
    return {
      cycles: findCycles(repo),
      violations: findLayerViolations(repo).filter((v) => v.message.startsWith("Service imports")),
      modules: [...modules.entries()].sort((a, b) => b[1] - a[1]),
      topImported: [...index.incoming.entries()].filter(([, v]) => v.length).sort((a, b) => b[1].length - a[1].length).slice(0, 5),
      lines: repo.files.reduce((s, f) => s + f.lineCount, 0),
      externals: [...new Set(repo.externalUsages.map((u) => EXTERNAL_SYSTEMS.find((s) => s.packages.includes(u.package))?.label).filter((l): l is string => Boolean(l)))],
    };
  }, [repo]);

  const totalLines = data.lines || 1;
  const skippedFiles = repo.skipped.reduce((s, i) => s + (i.fileCount ?? 1), 0);

  return (
    <>
      <PageHeader
        title={repo.name}
        subtitle={repo.description}
        actions={
          <>
            <Link href="/workspace" className="btn btn-primary btn-sm">
              <i className="bi bi-folder2-open me-1" aria-hidden="true" />
              Open workspace
            </Link>
            <button
              type="button"
              className="btn btn-outline-primary btn-sm"
              onClick={() => {
                setAssistantOpen(true);
                ask("Explain this project to me");
              }}
            >
              <i className="bi bi-stars me-1" aria-hidden="true" />
              Explain this project
            </button>
          </>
        }
      />

      <div className="row g-3 mb-3">
        {[
          ["Files analyzed", repo.analysis.analyzedFiles],
          ["Parsed (symbols + deps)", repo.analysis.parsedFiles],
          ["Directories", repo.directories.length],
          ["Lines of code", data.lines],
          ["API endpoints", repo.endpoints.length],
          ["Symbols", repo.symbols.length],
        ].map(([label, value]) => (
          <div className="col-6 col-md-4 col-xl-2" key={label}>
            <div className="cx-card p-3 h-100">
              <div className="stat">{value}</div>
              <div className="stat-label">{label}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="row g-3">
        <div className="col-lg-6">
          <section className="cx-card h-100" aria-labelledby="h-stack">
            <h2 className="cx-card-title" id="h-stack">
              Stack
            </h2>
            <div className="cx-card-body">
              <div className="progress mb-2" style={{ height: 10 }} role="img" aria-label="Language breakdown by lines">
                {repo.languages.map((l, i) => (
                  <div
                    key={l.language}
                    className="progress-bar"
                    style={{ width: `${(l.lines / totalLines) * 100}%`, background: ["#1f5fd6", "#1a7f4b", "#b25e09", "#a3338f", "#0d7d9b", "#8c959f"][i % 6] }}
                  />
                ))}
              </div>
              <div className="d-flex flex-wrap gap-2 mb-3">
                {repo.languages.map((l) => (
                  <span key={l.language} className="chip">
                    {l.language} · {l.files} files · {l.lines} lines
                  </span>
                ))}
              </div>
              <div className="stat-label mb-1">Frameworks and technologies</div>
              <div className="d-flex flex-wrap gap-1">
                {repo.technologies.map((t) => (
                  <span key={t} className="chip">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          </section>
        </div>

        <div className="col-lg-6">
          <section className="cx-card h-100" aria-labelledby="h-entry">
            <h2 className="cx-card-title" id="h-entry">
              Start here
            </h2>
            <div className="cx-card-body">
              <div className="stat-label mb-1">Entry points</div>
              <ul className="list-unstyled mb-3">
                {repo.entryPoints.map((e) => (
                  <li key={e.path}>
                    <SourceLink file={e.path} /> <span className="text-muted">— {getFile(repo, e.path)?.purpose} ({e.reason})</span>
                  </li>
                ))}
                {repo.entryPoints.length === 0 && <li className="text-muted">No entry point could be detected from package.json or framework conventions.</li>}
              </ul>
              <div className="stat-label mb-1">Detected API endpoints</div>
              <div className="d-flex flex-wrap gap-1">
                {repo.endpoints.length === 0 && <span className="text-muted">None detected (Express-style routers and Next.js route files are supported).</span>}
                {repo.endpoints.map((e) => (
                  <button
                    key={e.method + e.path}
                    type="button"
                    className="chip mono"
                    title={`${e.file}:${e.line}`}
                    onClick={() => openFile(e.file, { start: e.line, end: e.line })}
                  >
                    {e.method} {e.path}
                  </button>
                ))}
              </div>
            </div>
          </section>
        </div>

        <div className="col-lg-6">
          <section className="cx-card h-100" aria-labelledby="h-modules">
            <h2 className="cx-card-title" id="h-modules">
              Main modules
              <Link href="/architecture" className="small">
                View architecture
              </Link>
            </h2>
            <div className="cx-card-body">
              <div className="d-flex flex-wrap gap-2">
                {data.modules.map(([layer, count]) => (
                  <span key={layer} className="chip">
                    <span className="layer-dot" style={{ background: `var(--layer-${layer})` }} aria-hidden="true" />
                    {LAYER_LABEL[layer]} · {count}
                  </span>
                ))}
              </div>
              <p className="text-muted mt-3 mb-0">
                Architecture summary: {data.modules.length} layer(s) detected from directory names and file conventions
                {data.externals.length > 0 ? `, talking to ${data.externals.join(", ")}` : ""}. Derived from directory structure and imports, not from AI.
              </p>
            </div>
          </section>
        </div>

        <div className="col-lg-6">
          <section className="cx-card h-100" aria-labelledby="h-deps">
            <h2 className="cx-card-title" id="h-deps">
              Dependency overview
              <Link href="/dependencies" className="small">
                Explore dependencies
              </Link>
            </h2>
            <div className="cx-card-body">
              <div className="stat-label mb-1">Most depended-on files</div>
              <ul className="list-unstyled mb-3">
                {data.topImported.map(([file, from]) => (
                  <li key={file} className="d-flex justify-content-between gap-2">
                    <SourceLink file={file} />
                    <span className="text-muted">{from.length} importers</span>
                  </li>
                ))}
              </ul>
              <div className="text-muted">
                {repo.dependencies.length} internal imports · {repo.externalDependencies.filter((d) => !d.dev).length} runtime packages ·{" "}
                {repo.externalDependencies.filter((d) => d.dev).length} dev packages
              </div>
            </div>
          </section>
        </div>

        <div className="col-12">
          <section className="cx-card" aria-labelledby="h-concerns">
            <h2 className="cx-card-title" id="h-concerns">
              Potential structural concerns
            </h2>
            <div className="cx-card-body">
              <ul className="mb-0 d-flex flex-column gap-2">
                {data.cycles.map((c) => (
                  <li key={c.join()}>
                    <span className="evidence fact me-2">Fact</span>Circular dependency: {c.map((p, i) => (
                      <span key={p}>
                        {i > 0 && " ⇄ "}
                        <SourceLink file={p} />
                      </span>
                    ))}
                  </li>
                ))}
                {data.violations.length > 0 && (
                  <li>
                    <span className="evidence fact me-2">Fact</span>
                    {data.violations.length} service file(s) import from the HTTP middleware layer ({[...new Set(data.violations.map((v) => v.to))].join(", ")}), coupling business logic to the web framework.
                  </li>
                )}
                {repo.analysis.warnings.map((w) => (
                  <li key={w}>
                    <span className="evidence fact me-2">Fact</span>
                    {w}
                  </li>
                ))}
                {data.cycles.length === 0 && data.violations.length === 0 && repo.analysis.warnings.length === 0 && (
                  <li className="text-muted">No circular dependencies, layering violations or analysis warnings were found.</li>
                )}
              </ul>
            </div>
          </section>
        </div>

        <div className="col-12">
          <section className="cx-card" aria-labelledby="h-analysis">
            <h2 className="cx-card-title" id="h-analysis">
              Analysis summary
              <span className="chip">{repo.analysis.status === "partial" ? "Complete with skipped items" : "Complete"}</span>
            </h2>
            <div className="cx-card-body">
              <p>
                Analyzed <strong>{repo.analysis.analyzedFiles}</strong> files in {repo.analysis.durationMs} ms. Skipped about <strong>{skippedFiles.toLocaleString()}</strong> files across{" "}
                {repo.skipped.length} items. {repo.analysis.parsedFiles} files were parsed for symbols and imports; {repo.analysis.textOnlyFiles} are indexed as text only (unsupported language or non-code).
              </p>
              <div className="table-responsive">
                <table className="table table-sm align-middle mb-0">
                  <caption className="visually-hidden">Skipped files and directories</caption>
                  <thead>
                    <tr>
                      <th scope="col">Skipped item</th>
                      <th scope="col">Reason</th>
                      <th scope="col">Detail</th>
                      <th scope="col" className="text-end">
                        Files
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {repo.skipped.map((s) => (
                      <tr key={s.path}>
                        <td className="mono">{s.path}</td>
                        <td>{REASON_LABEL[s.reason] ?? s.reason}</td>
                        <td className="text-muted">{s.detail}</td>
                        <td className="text-end">{s.fileCount?.toLocaleString() ?? 1}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-muted small mt-2 mb-0">Nothing is dropped silently: every skipped item appears above with its reason.</p>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
