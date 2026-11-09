import { EXTERNAL_SYSTEMS } from "@/analysis/technologies";
import type { Repository } from "@/domain/types";
import { buildGraphIndex, computeImpact, findCycles, findLayerViolations, LAYER_LABEL } from "@/lib/graph/analysis";
import { buildModuleGraph } from "@/analysis/architecture";
import type { DocSection, PackFact } from "../schemas";

/**
 * Deterministic "analysis facts" computed from the parsed repository. They are passed to the model
 * (so it does not have to rediscover what static analysis already knows) and are all the mock provider uses.
 */

const MAX = 40;

function lineRef(file: string, line: number) {
  return { file, startLine: line, endLine: line };
}

function symbolRef(repo: Repository, file: string, name: string) {
  const s = repo.symbols.find((x) => x.file === file && x.name === name);
  return s ? { file, startLine: s.startLine, endLine: s.endLine, symbol: name } : undefined;
}

export function overviewFacts(repo: Repository): PackFact[] {
  const facts: PackFact[] = [];
  const parsed = repo.analysis.parsedFiles;
  facts.push({ text: `${repo.analysis.analyzedFiles} files were analyzed (${parsed} parsed for symbols and imports, ${repo.analysis.textOnlyFiles} indexed as text only); ${repo.skipped.length} item(s) were skipped.` });
  for (const e of repo.entryPoints.slice(0, 4)) {
    const first = repo.symbols.find((s) => s.file === e.path);
    facts.push({ text: `Likely entry point: ${e.path} (${e.reason}).`, ref: first ? { file: e.path, startLine: first.startLine, endLine: first.endLine, symbol: first.name } : undefined });
  }
  const layers = new Map<string, number>();
  for (const f of repo.files) if (f.parsed) layers.set(LAYER_LABEL[f.layer], (layers.get(LAYER_LABEL[f.layer]) ?? 0) + 1);
  if (layers.size) facts.push({ text: "Layers by file count: " + [...layers.entries()].sort((a, b) => b[1] - a[1]).map(([l, c]) => `${l} (${c})`).join(", ") + "." });
  if (repo.endpoints.length) {
    const sample = repo.endpoints.slice(0, 6);
    facts.push({ text: `${repo.endpoints.length} API endpoint(s) detected, e.g. ${sample.map((e) => `${e.method} ${e.path}`).join(", ")}.`, ref: lineRef(sample[0]?.file ?? "", sample[0]?.line ?? 1) });
  }
  const externals = externalSystems(repo);
  if (externals.length) facts.push({ text: `External systems used (from imported packages): ${externals.join(", ")}.` });
  return [...facts, ...concernFacts(repo)].slice(0, MAX);
}

export function concernFacts(repo: Repository): PackFact[] {
  const facts: PackFact[] = [];
  for (const cycle of findCycles(repo)) {
    const dep = repo.dependencies.find((d) => cycle.includes(d.from) && cycle.includes(d.to));
    facts.push({ text: `Circular dependency: ${cycle.join(" <-> ")}.`, ref: dep ? lineRef(dep.from, dep.line) : undefined });
  }
  for (const v of findLayerViolations(repo).filter((x) => x.message.startsWith("Service imports")).slice(0, 5)) {
    const dep = repo.dependencies.find((d) => d.from === v.from && d.to === v.to);
    facts.push({ text: `${v.from} imports ${v.to} (a service depending on the HTTP middleware layer).`, ref: dep ? lineRef(dep.from, dep.line) : undefined });
  }
  for (const w of repo.analysis.warnings.slice(0, 3)) facts.push({ text: `Analysis warning: ${w}` });
  return facts;
}

export function externalSystems(repo: Repository): string[] {
  return [...new Set(repo.externalUsages.map((u) => EXTERNAL_SYSTEMS.find((s) => s.packages.includes(u.package))?.label).filter((l): l is string => Boolean(l)))];
}

export function architectureFacts(repo: Repository): PackFact[] {
  const graph = buildModuleGraph(repo);
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const facts: PackFact[] = [];
  for (const n of graph.nodes.filter((x) => x.layer !== "external").slice(0, 14)) facts.push({ text: `Module ${n.label}: ${LAYER_LABEL[n.layer]} layer, ${n.description}.` });
  for (const e of graph.edges.slice(0, 22)) {
    const from = byId.get(e.source)?.label;
    const to = byId.get(e.target)?.label;
    if (from && to) facts.push({ text: e.evidence === "declared" ? `${from} uses ${to} (package ${e.label}).` : `${from} imports from ${to} (${e.label} import(s)).` });
  }
  return [...facts, ...concernFacts(repo)].slice(0, MAX);
}

export function flowFacts(repo: Repository, flowId: string): PackFact[] {
  const flow = repo.flows.find((f) => f.id === flowId);
  if (!flow) return [];
  const facts: PackFact[] = [{ text: `Flow "${flow.title}" triggered by ${flow.trigger}. ${flow.summary}` }];
  flow.steps.forEach((s, i) => {
    const sym = s.startLine ? undefined : repo.symbols.find((x) => x.file === s.file && x.name === s.symbol);
    const start = s.startLine ?? sym?.startLine;
    const end = s.endLine ?? sym?.endLine ?? start;
    facts.push({ text: `Step ${i + 1} (${s.evidence}): ${s.title} - ${s.description}`, ref: start && end ? { file: s.file, startLine: start, endLine: end, symbol: s.symbol } : undefined });
  });
  return facts.slice(0, MAX);
}

export function impactFacts(repo: Repository, target: string): PackFact[] {
  const impact = computeImpact(repo, target);
  const facts: PackFact[] = [];
  for (const dependent of impact.directDependents.slice(0, 15)) {
    const dep = repo.dependencies.find((d) => d.from === dependent && d.to === target);
    facts.push({ text: `${dependent} imports ${target} (direct dependent).`, ref: dep ? lineRef(dependent, dep.line) : undefined });
  }
  if (impact.transitiveDependents.length) facts.push({ text: `${impact.transitiveDependents.length} more file(s) depend on it indirectly, e.g. ${impact.transitiveDependents.slice(0, 8).join(", ")}.` });
  facts.push({ text: impact.affectedTests.length ? `Tests that import it directly or indirectly: ${impact.affectedTests.join(", ")}.` : "No test file imports it, even indirectly (it may still be covered at runtime)." });
  if (impact.affectedRoutes.length) {
    facts.push({ text: `Endpoints whose route files reach it: ${impact.affectedRoutes.map((e) => `${e.method} ${e.path}`).join(", ")}.`, ref: lineRef(impact.affectedRoutes[0]?.file ?? "", impact.affectedRoutes[0]?.line ?? 1) });
  }
  if (impact.dependencies.length) facts.push({ text: `It depends on ${impact.dependencies.length} project file(s): ${impact.dependencies.slice(0, 8).join(", ")}.` });
  for (const c of impact.cycles) facts.push({ text: `It is part of a circular dependency: ${c.join(" <-> ")}.` });
  facts.push({ text: "Static analysis cannot see dynamic usage, runtime wiring or consumers outside this repository, so this list may be incomplete." });
  return facts.slice(0, MAX);
}

export function explainFileFacts(repo: Repository, path: string): PackFact[] {
  const file = repo.files.find((f) => f.path === path);
  if (!file) return [];
  const index = buildGraphIndex(repo);
  const symbols = repo.symbols.filter((s) => s.file === path);
  const facts: PackFact[] = [{ text: `${path} is a ${LAYER_LABEL[file.layer]} file (${file.language}, ${file.lineCount} lines). ${file.purpose}` }];
  for (const s of symbols.slice(0, 12)) facts.push({ text: `${s.exported ? "Exports" : "Defines"} ${s.kind} ${s.name}${s.calls.length ? `, which calls ${s.calls.slice(0, 5).join(", ")}` : ""}.`, ref: { file: path, startLine: s.startLine, endLine: s.endLine, symbol: s.name } });
  const outgoing = index.outgoing.get(path) ?? [];
  const incoming = index.incoming.get(path) ?? [];
  facts.push({ text: `It imports ${outgoing.length ? outgoing.join(", ") : "no other project files"}.` });
  facts.push({ text: `It is imported by ${incoming.length ? incoming.join(", ") : "no other project files"}.` });
  const ext = [...new Set(repo.externalUsages.filter((u) => u.file === path).map((u) => u.package))];
  if (ext.length) facts.push({ text: `It uses external packages: ${ext.join(", ")}.` });
  if (!file.parsed) facts.push({ text: "This file type is indexed as text only, so symbols and dependencies were not extracted." });
  return facts.slice(0, MAX);
}

export function moduleFacts(repo: Repository, dir: string): PackFact[] {
  const mod = repo.modules.find((m) => m.path === dir || m.id === dir);
  const members = repo.files.filter((f) => f.dir === dir && f.parsed);
  const facts: PackFact[] = [];
  if (mod) facts.push({ text: `Module ${mod.path || "(root)"}: ${LAYER_LABEL[mod.layer]} layer, ${mod.fileCount} file(s), ${mod.lineCount} lines.` });
  for (const d of repo.moduleDependencies.filter((x) => x.from === (mod?.id ?? dir)).slice(0, 8)) facts.push({ text: `It imports from ${d.to} (${d.count} import(s)).` });
  for (const d of repo.moduleDependencies.filter((x) => x.to === (mod?.id ?? dir)).slice(0, 8)) facts.push({ text: `${d.from} imports from it (${d.count} import(s)).` });
  for (const f of members.slice(0, 10)) facts.push({ text: `${f.path}: ${f.purpose}` });
  return facts.slice(0, MAX);
}

export function docsFacts(repo: Repository, section: DocSection): PackFact[] {
  switch (section) {
    case "overview":
    case "onboarding":
      return overviewFacts(repo);
    case "architecture":
    case "modules":
      return architectureFacts(repo);
    case "api":
      return repo.endpoints.slice(0, 35).map((e) => ({ text: `${e.method} ${e.path}${e.handler ? ` handled by ${e.handler}` : ""}.`, ref: lineRef(e.file, e.line) }));
    case "flows":
      return repo.flows.slice(0, 6).flatMap((f) => [{ text: `Flow ${f.title}: ${f.summary}` }, ...f.steps.slice(0, 6).map((s, i) => ({ text: `${f.title}, step ${i + 1}: ${s.title}`, ref: s.startLine ? { file: s.file, startLine: s.startLine, endLine: s.endLine ?? s.startLine, symbol: s.symbol } : symbolRef(repo, s.file, s.symbol) }))]).slice(0, MAX);
    case "dependencies": {
      const index = buildGraphIndex(repo);
      const top = [...index.incoming.entries()].filter(([, v]) => v.length).sort((a, b) => b[1].length - a[1].length).slice(0, 8);
      return [
        ...top.map(([file, from]) => ({ text: `${file} is imported by ${from.length} file(s).` })),
        { text: `${repo.dependencies.length} internal imports; ${repo.externalDependencies.filter((d) => !d.dev).length} runtime and ${repo.externalDependencies.filter((d) => d.dev).length} dev packages declared.` },
        ...concernFacts(repo),
      ];
    }
  }
}
