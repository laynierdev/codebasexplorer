import type { Repository, SourceFile } from "@/domain/types";
import { buildGraphIndex, computeImpact, type GraphIndex } from "@/lib/graph/analysis";
import { AI_LIMITS, type AiTask, type ContextPack, type PackFact, type PackFile } from "../schemas";
import { architectureFacts, docsFacts, explainFileFacts, flowFacts, impactFacts, moduleFacts, overviewFacts } from "./facts";
import { bestLines, rankFiles } from "./retrieve";

/**
 * Context selection. Builds a bounded pack for one task: the files, symbols, dependencies and source excerpts
 * that matter for it, plus deterministic analysis facts. The whole repository is never sent.
 */

export interface PackOptions {
  selectedFile?: string;
  /** Size budget in characters (about 4 per token). */
  budgetChars?: number;
}

interface Window {
  start: number;
  end: number;
}

interface Pick {
  path: string;
  /** Source windows to include as excerpts (empty = outline only). */
  windows: Window[];
  /** Lower number = more important when the budget runs out. */
  priority: number;
}

const MAX_LINE_CHARS = 240;

export function buildContextPack(repo: Repository, task: AiTask, options: PackOptions = {}): ContextPack {
  const budget = Math.min(options.budgetChars ?? AI_LIMITS.defaultBudgetChars, AI_LIMITS.maxPackChars - 20_000);
  const index = buildGraphIndex(repo);
  const { picks, facts } = select(repo, task, index, options);
  return assemble(repo, picks, facts, index, budget, options.selectedFile);
}

/** Decides which files (and which parts of them) to consider, and which analysis facts to attach. */
function select(repo: Repository, task: AiTask, index: GraphIndex, options: PackOptions): { picks: Pick[]; facts: PackFact[] } {
  const byPath = new Map(repo.files.map((f) => [f.path, f]));
  const head = (path: string, lines: number): Window[] => {
    const f = byPath.get(path);
    return f && f.lineCount > 0 ? [{ start: 1, end: Math.min(f.lineCount, lines) }] : [];
  };
  const symbolWindows = (path: string, max: number): Window[] =>
    repo.symbols.filter((s) => s.file === path && s.exported).slice(0, max).map((s) => ({ start: s.startLine, end: Math.min(s.endLine, s.startLine + 40) }));

  switch (task.task) {
    case "overview": {
      const picks: Pick[] = [];
      repo.entryPoints.slice(0, 3).forEach((e, i) => picks.push({ path: e.path, windows: head(e.path, 80), priority: i }));
      const top = [...index.incoming.entries()].sort((a, b) => b[1].length - a[1].length).filter(([, v]) => v.length).slice(0, 6);
      top.forEach(([path], i) => picks.push({ path, windows: [], priority: 10 + i }));
      for (const e of repo.endpoints.slice(0, 3)) picks.push({ path: e.file, windows: [], priority: 20 });
      for (const f of repo.files.filter((x) => /^readme/i.test(x.name)).slice(0, 1)) picks.push({ path: f.path, windows: head(f.path, 40), priority: 5 });
      return { picks, facts: overviewFacts(repo) };
    }
    case "question": {
      const ranked = rankFiles(repo, task.question, { selectedFile: options.selectedFile, limit: 8 });
      const picks = ranked.map((r, i): Pick => {
        const f = byPath.get(r.path) as SourceFile | undefined;
        const windows: Window[] = [];
        if (f) {
          if (f.lineCount <= 120) windows.push({ start: 1, end: f.lineCount });
          else {
            const tokens = task.question.toLowerCase();
            for (const s of repo.symbols.filter((x) => x.file === r.path)) if (tokens.includes(s.name.toLowerCase()) || r.reasons.some((why) => why === `symbol ${s.name}`)) windows.push({ start: s.startLine, end: Math.min(s.endLine, s.startLine + 60) });
            for (const line of bestLines(f.content, task.question, 3)) windows.push({ start: Math.max(1, line - 6), end: Math.min(f.lineCount, line + 14) });
          }
        }
        return { path: r.path, windows, priority: i };
      });
      return { picks, facts: [] };
    }
    case "explain-file": {
      const picks: Pick[] = [{ path: task.path, windows: head(task.path, 400), priority: 0 }];
      (index.outgoing.get(task.path) ?? []).slice(0, 8).forEach((p, i) => picks.push({ path: p, windows: [], priority: 10 + i }));
      (index.incoming.get(task.path) ?? []).slice(0, 8).forEach((p, i) => picks.push({ path: p, windows: [], priority: 20 + i }));
      return { picks, facts: explainFileFacts(repo, task.path) };
    }
    case "explain-module": {
      const members = repo.files.filter((f) => f.dir === task.path && f.parsed).sort((a, b) => (index.incoming.get(b.path)?.length ?? 0) - (index.incoming.get(a.path)?.length ?? 0));
      const picks = members.slice(0, 12).map((f, i): Pick => ({ path: f.path, windows: i < 3 ? head(f.path, 70) : [], priority: i }));
      return { picks, facts: moduleFacts(repo, task.path) };
    }
    case "architecture": {
      const picks: Pick[] = [];
      repo.entryPoints.slice(0, 2).forEach((e, i) => picks.push({ path: e.path, windows: head(e.path, 50), priority: i }));
      repo.modules.filter((m) => m.layer !== "test").slice(0, 10).forEach((m, i) => {
        const rep = repo.files.filter((f) => f.dir === m.path && f.parsed).sort((a, b) => (index.incoming.get(b.path)?.length ?? 0) - (index.incoming.get(a.path)?.length ?? 0))[0];
        if (rep) picks.push({ path: rep.path, windows: [], priority: 10 + i });
      });
      return { picks, facts: architectureFacts(repo) };
    }
    case "flow": {
      const flow = repo.flows.find((f) => f.id === task.flowId);
      const picks: Pick[] = [];
      (flow?.steps ?? []).slice(0, 14).forEach((s, i) => {
        const sym = s.startLine ? undefined : repo.symbols.find((x) => x.file === s.file && x.name === s.symbol);
        const start = s.startLine ?? sym?.startLine;
        const end = s.endLine ?? sym?.endLine ?? start;
        picks.push({ path: s.file, windows: start && end ? [{ start, end: Math.min(end, start + 60) }] : [], priority: i });
      });
      return { picks, facts: flowFacts(repo, task.flowId) };
    }
    case "impact": {
      const impact = computeImpact(repo, task.target);
      const picks: Pick[] = [{ path: task.target, windows: head(task.target, 200), priority: 0 }];
      impact.directDependents.slice(0, 10).forEach((p, i) => {
        const dep = repo.dependencies.find((d) => d.from === p && d.to === task.target);
        picks.push({ path: p, windows: dep ? [{ start: Math.max(1, dep.line - 2), end: dep.line + 25 }] : [], priority: 1 + i });
      });
      impact.affectedTests.slice(0, 4).forEach((p, i) => picks.push({ path: p, windows: [], priority: 20 + i }));
      impact.affectedRoutes.slice(0, 4).forEach((e, i) => picks.push({ path: e.file, windows: [], priority: 30 + i }));
      return { picks, facts: impactFacts(repo, task.target) };
    }
    case "docs": {
      const facts = docsFacts(repo, task.section);
      const picks: Pick[] = [];
      if (task.section === "api") {
        const seen = new Set<string>();
        for (const e of repo.endpoints) {
          if (!seen.has(e.file) && seen.size < 6) {
            seen.add(e.file);
            picks.push({ path: e.file, windows: head(e.file, 40), priority: seen.size });
          }
          if (e.handlerFile && !seen.has(e.handlerFile) && seen.size < 12) {
            seen.add(e.handlerFile);
            picks.push({ path: e.handlerFile, windows: [], priority: 20 + seen.size });
          }
        }
      } else if (task.section === "onboarding") {
        for (const f of repo.files.filter((x) => /^(readme|package\.json|\.env\.example)/i.test(x.name)).slice(0, 3)) picks.push({ path: f.path, windows: head(f.path, 60), priority: 0 });
        repo.entryPoints.slice(0, 2).forEach((e, i) => picks.push({ path: e.path, windows: head(e.path, 50), priority: 3 + i }));
      } else if (task.section === "flows") {
        for (const s of repo.flows.slice(0, 3).flatMap((f) => f.steps.slice(0, 5))) picks.push({ path: s.file, windows: [], priority: 5 });
      } else {
        const sel = select(repo, { task: "overview" }, index, options);
        picks.push(...sel.picks);
      }
      return { picks, facts };
    }
    case "semantic-search": {
      const picks = rankFiles(repo, task.query, { selectedFile: options.selectedFile, limit: 25 }).map((r, i): Pick => ({ path: r.path, windows: i < 3 ? symbolWindows(r.path, 2) : [], priority: i }));
      return { picks, facts: [] };
    }
  }
}

function mergeWindows(windows: Window[], lineCount: number, maxLines: number): Window[] {
  const sorted = windows
    .map((w) => ({ start: Math.max(1, w.start), end: Math.min(lineCount, w.end) }))
    .filter((w) => w.end >= w.start)
    .sort((a, b) => a.start - b.start);
  const merged: Window[] = [];
  for (const w of sorted) {
    const last = merged[merged.length - 1];
    if (last && w.start <= last.end + 3) last.end = Math.max(last.end, w.end);
    else merged.push({ ...w });
  }
  let remaining = maxLines;
  const out: Window[] = [];
  for (const w of merged) {
    if (remaining <= 0) break;
    const len = Math.min(w.end - w.start + 1, remaining);
    out.push({ start: w.start, end: w.start + len - 1 });
    remaining -= len;
  }
  return out.slice(0, AI_LIMITS.maxExcerptsPerFile);
}

function excerptText(file: SourceFile, w: Window): string {
  return file.content
    .split("\n")
    .slice(w.start - 1, w.end)
    .map((l) => (l.length > MAX_LINE_CHARS ? l.slice(0, MAX_LINE_CHARS) + " ..." : l))
    .join("\n");
}

function assemble(repo: Repository, picks: Pick[], facts: PackFact[], index: GraphIndex, budget: number, selectedFile?: string): ContextPack {
  const byPath = new Map(repo.files.map((f) => [f.path, f]));
  const symbolsByFile = new Map<string, typeof repo.symbols>();
  for (const s of repo.symbols) symbolsByFile.set(s.file, [...(symbolsByFile.get(s.file) ?? []), s]);

  // De-duplicate picks keeping the best priority and the union of windows.
  const unique = new Map<string, Pick>();
  for (const p of picks) {
    if (!byPath.has(p.path)) continue;
    const existing = unique.get(p.path);
    if (existing) {
      existing.priority = Math.min(existing.priority, p.priority);
      existing.windows.push(...p.windows);
    } else unique.set(p.path, { ...p, windows: [...p.windows] });
  }
  const ordered = [...unique.values()].sort((a, b) => a.priority - b.priority).slice(0, AI_LIMITS.maxFilesInPack);

  let used = JSON.stringify(facts).length + 2000;
  let truncated = unique.size > ordered.length;
  const files: PackFile[] = [];

  // Pass 1: outlines for every selected file; pass 2: excerpts in priority order while budget lasts.
  for (const pick of ordered) {
    const f = byPath.get(pick.path) as SourceFile;
    const outline: PackFile = {
      path: f.path,
      language: f.language,
      layer: f.layer,
      purpose: f.purpose.slice(0, 600),
      lineCount: f.lineCount,
      symbols: (symbolsByFile.get(f.path) ?? []).slice(0, 80).map((s) => ({ name: s.name, kind: s.kind, startLine: s.startLine, endLine: s.endLine, exported: s.exported })),
      imports: (index.outgoing.get(f.path) ?? []).slice(0, 40),
      importedBy: (index.incoming.get(f.path) ?? []).slice(0, 40),
      excerpts: [],
    };
    const cost = JSON.stringify(outline).length;
    if (used + cost > budget) {
      truncated = true;
      continue;
    }
    used += cost;
    files.push(outline);
  }
  for (const outline of files) {
    const pick = unique.get(outline.path) as Pick;
    const f = byPath.get(outline.path) as SourceFile;
    const maxLines = pick.priority === 0 ? 400 : 140;
    for (const w of mergeWindows(pick.windows, f.lineCount, maxLines)) {
      const text = excerptText(f, w);
      if (used + text.length > budget) {
        truncated = true;
        break;
      }
      used += text.length + 40;
      outline.excerpts.push({ startLine: w.start, endLine: w.end, text });
    }
  }

  return {
    repo: {
      name: repo.name,
      description: repo.description.slice(0, 400),
      fileCount: repo.analysis.analyzedFiles,
      parsedFileCount: repo.analysis.parsedFiles,
      languages: repo.languages.slice(0, 8).map((l) => `${l.language} (${l.files})`),
      technologies: repo.technologies.slice(0, 40),
      entryPoints: repo.entryPoints.slice(0, 10),
      endpoints: repo.endpoints.slice(0, 40).map((e) => `${e.method} ${e.path} (${e.file}:${e.line})`),
    },
    files,
    facts: facts.slice(0, AI_LIMITS.maxFacts),
    selectedFile,
    truncated,
  };
}
