import type { AnswerBlock, Repository, SourceRef } from "@/domain/types";
import type { AiRef, Answer, DocOutput, SearchRank } from "./schemas";

/**
 * Grounding: validates what the model claims against the REAL repository, because the model can be wrong.
 * - references to missing files, impossible line ranges or unknown symbols are corrected or dropped;
 * - "fact" blocks that end up without a verified reference are downgraded to "inference";
 * - file paths mentioned in prose that do not exist are reported;
 * - code excerpts are never taken from the model: the UI reads them from the repository.
 */

export interface GroundingReport {
  droppedRefs: number;
  clampedRefs: number;
  snappedRefs: number;
  droppedSymbols: number;
  downgradedFacts: number;
  unverifiedMentions: string[];
}

export function emptyReport(): GroundingReport {
  return { droppedRefs: 0, clampedRefs: 0, snappedRefs: 0, droppedSymbols: 0, downgradedFacts: 0, unverifiedMentions: [] };
}

export interface GroundingOptions {
  /** Facts must carry at least one verified reference (true for model output; mock facts are analysis output). */
  requireRefsForFacts: boolean;
}

/** Validates one reference. Returns null when it cannot be verified. */
export function groundRef(repo: Repository, ref: AiRef | SourceRef, report: GroundingReport): SourceRef | null {
  const file = repo.files.find((f) => f.path === ref.file);
  if (!file || file.lineCount === 0) {
    report.droppedRefs++;
    return null;
  }
  let start = Math.floor(ref.startLine);
  let end = Math.floor(ref.endLine);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 1 || start > file.lineCount) {
    report.droppedRefs++;
    return null;
  }
  if (end < start) end = start;
  if (end > file.lineCount) {
    end = file.lineCount;
    report.clampedRefs++;
  }

  let symbol = ref.symbol;
  if (symbol) {
    const sym = repo.symbols.find((s) => s.file === file.path && s.name === symbol);
    if (!sym) {
      symbol = undefined;
      report.droppedSymbols++;
    } else if (end < sym.startLine || start > sym.endLine) {
      // The lines do not touch the named symbol: trust the verified symbol range over the model's numbers.
      start = sym.startLine;
      end = sym.endLine;
      report.snappedRefs++;
    }
  }
  return { file: file.path, startLine: start, endLine: end, ...(symbol ? { symbol } : {}) };
}

const PATH_LIKE = /(?:[\w@.-]+\/)*[\w@.-]+\.(?:tsx?|jsx?|mjs|cjs|json|md|py|go|rs|java|rb|php|css|html|ya?ml|sql|sh|cs|cpp|c|h)\b/g;

/** File paths mentioned in text that are not in the repository (possible fabrications). */
export function findUnverifiedMentions(repo: Repository, text: string, knownPaths?: Set<string>): string[] {
  const paths = knownPaths ?? new Set(repo.files.map((f) => f.path));
  const names = new Set(repo.files.map((f) => f.name));
  const missing = new Set<string>();
  for (const raw of text.replace(/[a-z]+:\/\/\S+/gi, " ").match(PATH_LIKE) ?? []) {
    const mention = raw.replace(/^\.\//, "").replace(/[.,;:)]+$/, "");
    if (mention.includes("://") || /^\d/.test(mention)) continue;
    if (paths.has(mention) || names.has(mention)) continue;
    if (mention.includes("/") && [...paths].some((p) => p.endsWith("/" + mention))) continue;
    // Skip skipped/ignored items the analysis itself reported (e.g. package-lock.json).
    if (repo.skipped.some((s) => s.path === mention || s.path.endsWith("/" + mention))) continue;
    missing.add(mention);
  }
  return [...missing];
}

export function groundAnswer(repo: Repository, answer: Answer, options: GroundingOptions): { blocks: AnswerBlock[]; report: GroundingReport } {
  const report = emptyReport();
  const paths = new Set(repo.files.map((f) => f.path));
  const mentions = new Set<string>();
  const blocks: AnswerBlock[] = answer.blocks.map((b) => {
    const refs = b.refs.map((r) => groundRef(repo, r, report)).filter((r): r is SourceRef => r !== null);
    let kind = b.kind;
    let downgraded = false;
    if (kind === "fact" && refs.length === 0 && options.requireRefsForFacts) {
      kind = "inference";
      downgraded = true;
      report.downgradedFacts++;
    }
    for (const m of findUnverifiedMentions(repo, b.text, paths)) mentions.add(m);
    return { kind, text: b.text, refs, ...(downgraded ? { downgraded } : {}) };
  });
  report.unverifiedMentions = [...mentions];
  return { blocks, report };
}

export interface GroundedDoc {
  title: string;
  sections: { heading: string; markdown: string; refs: SourceRef[] }[];
}

export function groundDocs(repo: Repository, doc: DocOutput): { doc: GroundedDoc; report: GroundingReport } {
  const report = emptyReport();
  const paths = new Set(repo.files.map((f) => f.path));
  const mentions = new Set<string>();
  const sections = doc.sections.map((s) => {
    for (const m of findUnverifiedMentions(repo, s.markdown, paths)) mentions.add(m);
    return { heading: s.heading, markdown: s.markdown, refs: s.refs.map((r) => groundRef(repo, r, report)).filter((r): r is SourceRef => r !== null) };
  });
  report.unverifiedMentions = [...mentions];
  return { doc: { title: doc.title, sections }, report };
}

export interface GroundedSearchResult {
  file: string;
  line: number;
  reason: string;
}

export function groundSearch(repo: Repository, rank: SearchRank): { results: GroundedSearchResult[]; note?: string; dropped: number } {
  let dropped = 0;
  const results: GroundedSearchResult[] = [];
  const seen = new Set<string>();
  for (const r of rank.results) {
    const file = repo.files.find((f) => f.path === r.file);
    if (!file || seen.has(file.path)) {
      dropped++;
      continue;
    }
    seen.add(file.path);
    const line = r.line && r.line >= 1 && r.line <= Math.max(1, file.lineCount) ? r.line : 1;
    results.push({ file: file.path, line, reason: r.reason });
  }
  return { results, note: rank.note, dropped };
}

/** Human-readable warnings for the UI from a grounding report. */
export function describeReport(report: GroundingReport): string[] {
  const out: string[] = [];
  if (report.droppedRefs) out.push(`${report.droppedRefs} reference(s) pointed to missing files or lines and were removed.`);
  if (report.clampedRefs || report.snappedRefs) out.push(`${report.clampedRefs + report.snappedRefs} reference(s) had inexact line numbers and were corrected against the source.`);
  if (report.droppedSymbols) out.push(`${report.droppedSymbols} symbol name(s) were not found in the cited file and were removed.`);
  if (report.downgradedFacts) out.push(`${report.downgradedFacts} statement(s) labelled as fact had no verifiable source and were shown as inference.`);
  if (report.unverifiedMentions.length) out.push(`The text mentions files that are not in this repository: ${report.unverifiedMentions.slice(0, 5).join(", ")}.`);
  return out;
}
