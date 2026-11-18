import type { AnalysisLimits } from "@/domain/types";

const MB = 1024 * 1024;

/**
 * Default analysis limits. Kept in a module without schema imports so UI code can use the constants
 * without pulling the validation library into the initial JavaScript bundle (see limits.ts for validation).
 */
export const DEFAULT_LIMITS: AnalysisLimits = {
  maxArchiveBytes: 50 * MB,
  maxTotalBytes: 250 * MB,
  maxFileBytes: 1 * MB,
  maxEntries: 50_000,
  maxFiles: 10_000,
  maxCompressionRatio: 100,
  maxPathLength: 512,
  maxPathDepth: 40,
  extraIgnores: [],
  respectGitignore: true,
};
