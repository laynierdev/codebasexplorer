import type { ZodType } from "zod";
import { AnswerSchema, DocOutputSchema, SearchRankSchema, type AiResult, type AiTask } from "./schemas";

export type ResultKind = AiResult["kind"];

/** Which structured output each task must produce. */
export function outputFor(task: AiTask): { kind: ResultKind; schema: ZodType } {
  if (task.task === "docs") return { kind: "docs", schema: DocOutputSchema };
  if (task.task === "semantic-search") return { kind: "search", schema: SearchRankSchema };
  return { kind: "answer", schema: AnswerSchema };
}
