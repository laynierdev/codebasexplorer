import { AnalysisLimitsSchema } from "@/domain/schemas";
import type { AnalysisLimits } from "@/domain/types";

const MB = 1024 * 1024;

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

/** Validates user-provided limits and fills in defaults. Throws a ZodError on invalid input. */
export function resolveLimits(input?: Partial<AnalysisLimits>): AnalysisLimits {
  return AnalysisLimitsSchema.parse({ ...DEFAULT_LIMITS, ...input });
}

export type ArchiveErrorCode =
  | "archive-too-large"
  | "not-a-zip"
  | "too-many-entries"
  | "unsafe-path"
  | "path-too-long"
  | "path-too-deep"
  | "duplicate-path"
  | "uncompressed-too-large"
  | "compression-ratio"
  | "size-mismatch"
  | "encrypted"
  | "empty";

/** Thrown when an archive must be rejected as a whole (unsafe or abusive structure). */
export class ArchiveError extends Error {
  constructor(
    public readonly code: ArchiveErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ArchiveError";
  }
}
