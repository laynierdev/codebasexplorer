import type { AiProvider, AiProviderRequest, AiProviderResult } from "../provider";
import type { AiRef, ContextPack, DocOutput, SearchRank, AiTask } from "../schemas";

const MOCK_NOTICE =
  "Mock mode: this answer was assembled from deterministic analysis results (and file/symbol name matching), not by reading the code. Configure Gemini for explanations and reasoning.";

/**
 * Deterministic provider that needs no credentials. It reshapes the analysis facts that the browser put
 * in the context pack, so every statement and reference it returns comes from real analysis output.
 */
export class MockProvider implements AiProvider {
  readonly id = "mock" as const;

  async run({ task, context }: AiProviderRequest, _signal?: AbortSignal): Promise<AiProviderResult> {
    if (task.task === "docs") return { result: { kind: "docs", data: docsFrom(task, context) }, model: "mock" };
    if (task.task === "semantic-search") return { result: { kind: "search", data: searchFrom(context) }, model: "mock" };
    return { result: { kind: "answer", data: { blocks: answerFrom(task, context) } }, model: "mock" };
  }
}

function refOf(file: string, start: number, end: number): AiRef {
  return { file, startLine: start, endLine: Math.max(start, end) };
}

function answerFrom(task: AiTask, pack: ContextPack) {
  const blocks: { kind: "fact" | "inference" | "recommendation" | "uncertain"; text: string; refs: AiRef[] }[] = [];
  for (const fact of pack.facts.slice(0, 10)) {
    blocks.push({ kind: "fact", text: fact.text, refs: fact.ref ? [{ file: fact.ref.file, startLine: fact.ref.startLine, endLine: fact.ref.endLine, symbol: fact.ref.symbol }] : [] });
  }

  if (task.task === "question" || blocks.length === 0) {
    const related = pack.files.slice(0, 5).map((f) => {
      const first = f.symbols[0];
      return first ? refOf(f.path, first.startLine, first.endLine) : refOf(f.path, 1, Math.max(1, Math.min(f.lineCount, 1)));
    });
    if (related.length > 0) {
      blocks.push({
        kind: "inference",
        text: "These files look most related to the request, judged by file names, symbol names and text matches: " + pack.files.slice(0, 5).map((f) => f.path).join(", ") + ".",
        refs: related,
      });
    }
  }

  if (blocks.length === 0) {
    blocks.push({ kind: "uncertain", text: "No relevant evidence was found in the analyzed repository for this request, so nothing can be said with confidence.", refs: [] });
  }
  if (pack.truncated) blocks.push({ kind: "uncertain", text: "The context selection was truncated by the size budget, so this view is partial.", refs: [] });
  blocks.push({ kind: "uncertain", text: MOCK_NOTICE, refs: [] });
  return blocks.slice(0, 14);
}

function docsFrom(task: Extract<AiTask, { task: "docs" }>, pack: ContextPack): DocOutput {
  const bullets = pack.facts.map((f) => `- ${f.text}${f.ref ? ` (\`${f.ref.file}:${f.ref.startLine}-${f.ref.endLine}\`)` : ""}`);
  const files = pack.files.slice(0, 12).map((f) => `- \`${f.path}\`: ${f.purpose || f.layer}`);
  const sections: DocOutput["sections"] = [];
  if (bullets.length) sections.push({ heading: "Analysis facts", markdown: bullets.join("\n").slice(0, 5900), refs: pack.facts.flatMap((f) => (f.ref ? [f.ref] : [])).slice(0, 12) });
  if (files.length) sections.push({ heading: "Relevant files", markdown: files.join("\n").slice(0, 5900), refs: [] });
  sections.push({ heading: "About this draft", markdown: MOCK_NOTICE, refs: [] });
  return { title: `${pack.repo.name}: ${task.section}`, sections };
}

function searchFrom(pack: ContextPack): SearchRank {
  return {
    results: pack.files.slice(0, 10).map((f) => ({ file: f.path, line: f.symbols[0]?.startLine, reason: f.purpose || `${f.layer} file ranked by name, symbol and text matches` })),
    note: "Mock mode: ranking by keyword relevance only.",
  };
}
