import { z } from "zod";
import { LanguageSchema, LayerSchema, SourceRefSchema, SymbolKindSchema } from "@/domain/schemas";

/**
 * Schemas for everything that crosses the AI boundary: what the browser sends to the server
 * (a bounded context pack, never the whole repository) and what the model must answer
 * (structured JSON, validated before anything is shown).
 */

export const AI_LIMITS = {
  maxQuestionChars: 2000,
  maxTargetChars: 512,
  maxPackChars: 160_000,
  maxFilesInPack: 30,
  maxExcerptsPerFile: 6,
  maxExcerptChars: 14_000,
  maxFacts: 60,
  /** Default selection budget used by the browser when building a pack (characters, about 4 chars per token). */
  defaultBudgetChars: 90_000,
} as const;

export const ClaimKindSchema = z.enum(["fact", "inference", "recommendation", "uncertain"]);

/* ---------- Context pack (browser → server) ---------- */

export const PackExcerptSchema = z.object({
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1),
  /** Raw source lines joined with newlines; line numbers are re-attached when the prompt is built. */
  text: z.string().max(AI_LIMITS.maxExcerptChars),
});

export const PackFileSchema = z.object({
  path: z.string().min(1).max(512),
  language: LanguageSchema,
  layer: LayerSchema,
  purpose: z.string().max(600),
  lineCount: z.number().int().nonnegative(),
  symbols: z
    .array(z.object({ name: z.string().max(200), kind: SymbolKindSchema, startLine: z.number().int().min(1), endLine: z.number().int().min(1), exported: z.boolean() }))
    .max(80),
  imports: z.array(z.string().max(512)).max(40),
  importedBy: z.array(z.string().max(512)).max(40),
  excerpts: z.array(PackExcerptSchema).max(AI_LIMITS.maxExcerptsPerFile),
});

/** A deterministic statement computed from source analysis, optionally anchored to a reference. */
export const PackFactSchema = z.object({
  text: z.string().min(1).max(700),
  ref: SourceRefSchema.optional(),
});

export const ContextPackSchema = z.object({
  repo: z.object({
    name: z.string().max(200),
    description: z.string().max(400),
    fileCount: z.number().int().nonnegative(),
    parsedFileCount: z.number().int().nonnegative(),
    languages: z.array(z.string().max(60)).max(20),
    technologies: z.array(z.string().max(80)).max(40),
    entryPoints: z.array(z.object({ path: z.string().max(512), reason: z.string().max(200) })).max(10),
    endpoints: z.array(z.string().max(300)).max(40),
  }),
  files: z.array(PackFileSchema).max(AI_LIMITS.maxFilesInPack),
  facts: z.array(PackFactSchema).max(AI_LIMITS.maxFacts),
  selectedFile: z.string().max(512).optional(),
  /** True when the selection budget cut relevant material, so the model can say its view is partial. */
  truncated: z.boolean(),
});

export const DOC_SECTIONS = ["overview", "architecture", "modules", "api", "flows", "dependencies", "onboarding"] as const;
export const DocSectionSchema = z.enum(DOC_SECTIONS);

const question = z.string().trim().min(1).max(AI_LIMITS.maxQuestionChars);
const target = z.string().trim().min(1).max(AI_LIMITS.maxTargetChars);

/** What the browser asks for (before a context pack is attached). */
export const AiTaskSchema = z.discriminatedUnion("task", [
  z.object({ task: z.literal("overview") }),
  z.object({ task: z.literal("question"), question }),
  z.object({ task: z.literal("explain-file"), path: target }),
  z.object({ task: z.literal("explain-module"), path: target }),
  z.object({ task: z.literal("architecture") }),
  z.object({ task: z.literal("flow"), flowId: target }),
  z.object({ task: z.literal("impact"), target }),
  z.object({ task: z.literal("docs"), section: DocSectionSchema }),
  z.object({ task: z.literal("semantic-search"), query: question }),
]);

/** What the server receives: a task plus the context pack selected for it. */
export const AiRequestSchema = z.object({ task: AiTaskSchema, context: ContextPackSchema });

/* ---------- Model output (server ← model) ---------- */

export const AiRefSchema = z.object({
  file: z.string().max(512),
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1),
  symbol: z.string().max(200).optional(),
});

export const AiBlockSchema = z.object({
  kind: ClaimKindSchema,
  text: z.string().min(1).max(2500),
  refs: z.array(AiRefSchema).max(8),
});

export const AnswerSchema = z.object({ blocks: z.array(AiBlockSchema).min(1).max(14) });

export const DocOutputSchema = z.object({
  title: z.string().min(1).max(200),
  sections: z
    .array(z.object({ heading: z.string().min(1).max(200), markdown: z.string().min(1).max(6000), refs: z.array(AiRefSchema).max(12) }))
    .min(1)
    .max(12),
});

export const SearchRankSchema = z.object({
  results: z.array(z.object({ file: z.string().max(512), line: z.number().int().min(1).optional(), reason: z.string().max(300) })).max(10),
  note: z.string().max(400).optional(),
});

/* ---------- Response envelope (server → browser) ---------- */

export const AiResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("answer"), data: AnswerSchema }),
  z.object({ kind: z.literal("docs"), data: DocOutputSchema }),
  z.object({ kind: z.literal("search"), data: SearchRankSchema }),
]);

export const AiResponseSchema = z.object({
  provider: z.enum(["gemini", "mock"]),
  model: z.string().optional(),
  /** True when the answer came from the mock provider (by configuration or after a fallback). */
  mock: z.boolean(),
  /** Set when Gemini was expected but failed and the mock answered instead. */
  fallback: z.object({ reason: z.string().max(300), code: z.string() }).optional(),
  durationMs: z.number().nonnegative(),
  attempts: z.number().int().min(0),
  usage: z.object({ inputTokens: z.number().int().optional(), outputTokens: z.number().int().optional() }).optional(),
  /** Set when repository text looked like instructions aimed at an AI (it was still treated as data). */
  injectionSuspected: z.boolean(),
  result: AiResultSchema,
});

export const AiStatusSchema = z.object({
  /** Provider that will answer requests right now. */
  provider: z.enum(["gemini", "mock"]),
  model: z.string().optional(),
  /** Value of AI_PROVIDER. */
  mode: z.enum(["auto", "gemini", "mock"]),
  keyConfigured: z.boolean(),
  fallbackToMock: z.boolean(),
  issues: z.array(z.string()),
});

export type ClaimKind = z.infer<typeof ClaimKindSchema>;
export type PackFile = z.infer<typeof PackFileSchema>;
export type PackFact = z.infer<typeof PackFactSchema>;
export type ContextPack = z.infer<typeof ContextPackSchema>;
export type DocSection = z.infer<typeof DocSectionSchema>;
export type AiTask = z.infer<typeof AiTaskSchema>;
export type AiRequest = z.infer<typeof AiRequestSchema>;
export type AiRef = z.infer<typeof AiRefSchema>;
export type Answer = z.infer<typeof AnswerSchema>;
export type DocOutput = z.infer<typeof DocOutputSchema>;
export type SearchRank = z.infer<typeof SearchRankSchema>;
export type AiResult = z.infer<typeof AiResultSchema>;
export type AiResponse = z.infer<typeof AiResponseSchema>;
export type AiStatus = z.infer<typeof AiStatusSchema>;
