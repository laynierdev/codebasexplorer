import { RepositorySchema } from "@/domain/schemas";
import type { Repository } from "@/domain/types";

/**
 * Validates an analysis result against the domain schema. Use at trust boundaries (worker output, imports).
 * Kept separate from the analyzer so UI code can validate without bundling the parsers.
 */
export function validateRepository(value: unknown): Repository {
  return RepositorySchema.parse(value);
}
