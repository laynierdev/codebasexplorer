import type { Repository } from "@/domain/types";

/** Starter questions tailored to what the analysis found in the repository. */
export function suggestedQuestions(repo: Repository): string[] {
  const questions = ["Explain this project to me"];
  if (repo.files.some((f) => /auth|login|session|token/i.test(f.path))) questions.push("How does authentication work?");
  if (repo.endpoints.length > 0) questions.push("Where should I implement a new endpoint?");
  if (repo.externalUsages.some((u) => /^(pg|mysql2?|mongodb|mongoose|redis|ioredis|@prisma\/client|drizzle-orm|better-sqlite3|sqlite3)$/.test(u.package))) {
    questions.push("Where is the database accessed?");
  }
  questions.push("Identify potential architectural problems");
  return questions.slice(0, 5);
}
