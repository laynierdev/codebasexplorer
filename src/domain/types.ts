import type { z } from "zod";
import type * as s from "./schemas";

/** Domain types, inferred from the Zod schemas in `./schemas.ts` (the source of truth). */

export type { TreeNode } from "./schemas";

export type Language = z.infer<typeof s.LanguageSchema>;
export type FileKind = z.infer<typeof s.FileKindSchema>;
export type Layer = z.infer<typeof s.LayerSchema>;
export type SourceFile = z.infer<typeof s.SourceFileSchema>;
export type Directory = z.infer<typeof s.DirectorySchema>;
export type SymbolKind = z.infer<typeof s.SymbolKindSchema>;
export type SourceSymbol = z.infer<typeof s.SourceSymbolSchema>;
export type FileDependency = z.infer<typeof s.FileDependencySchema>;
export type ExternalDependency = z.infer<typeof s.ExternalDependencySchema>;
export type ExternalUsage = z.infer<typeof s.ExternalUsageSchema>;
export type EntryPoint = z.infer<typeof s.EntryPointSchema>;
export type SourceRef = z.infer<typeof s.SourceRefSchema>;
export type ApiEndpoint = z.infer<typeof s.ApiEndpointSchema>;
export type Module = z.infer<typeof s.ModuleSchema>;
export type ModuleDependency = z.infer<typeof s.ModuleDependencySchema>;
export type ArchNode = z.infer<typeof s.ArchNodeSchema>;
export type ArchEdge = z.infer<typeof s.ArchEdgeSchema>;
export type FlowStep = z.infer<typeof s.FlowStepSchema>;
export type ExecutionFlow = z.infer<typeof s.ExecutionFlowSchema>;
export type SkipReason = z.infer<typeof s.SkipReasonSchema>;
export type SkippedItem = z.infer<typeof s.SkippedItemSchema>;
export type AnalysisResult = z.infer<typeof s.AnalysisResultSchema>;
export type LanguageStat = z.infer<typeof s.LanguageStatSchema>;
export type Repository = z.infer<typeof s.RepositorySchema>;
export type SearchMode = z.infer<typeof s.SearchModeSchema>;
export type SearchResult = z.infer<typeof s.SearchResultSchema>;
export type ImpactResult = z.infer<typeof s.ImpactResultSchema>;
export type AnalysisLimits = z.infer<typeof s.AnalysisLimitsSchema>;

/* ---------- Assistant (Stage 3 will add schemas for structured AI output) ---------- */

export type ClaimKind = "fact" | "inference" | "recommendation" | "uncertain";

export interface AnswerBlock {
  kind: ClaimKind;
  text: string;
  refs?: SourceRef[];
}

export interface AssistantMessage {
  id: string;
  role: "user" | "assistant";
  text?: string;
  blocks?: AnswerBlock[];
  provider?: "mock" | "gemini";
}
