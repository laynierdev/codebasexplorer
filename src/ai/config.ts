import { z } from "zod";
import type { AiStatus } from "./schemas";

/**
 * AI configuration from environment variables. SERVER ONLY: this module reads secrets and must never be
 * imported from client components.
 */

const boolish = z
  .string()
  .trim()
  .toLowerCase()
  .transform((v) => !["false", "0", "no", "off"].includes(v));

const EnvSchema = z.object({
  AI_PROVIDER: z.enum(["auto", "gemini", "mock"]).default("auto"),
  GEMINI_API_KEY: z.string().trim().optional(),
  GEMINI_MODEL: z.string().trim().min(1).default("gemini-3.5-flash"),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(55_000).default(45_000),
  AI_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(4).default(3),
  AI_FALLBACK_TO_MOCK: boolish.default(true),
});

export interface AiConfig {
  mode: "auto" | "gemini" | "mock";
  /** Provider that answers requests: gemini only when a key is available (or demanded explicitly). */
  provider: "gemini" | "mock";
  apiKey?: string;
  model: string;
  timeoutMs: number;
  maxAttempts: number;
  fallbackToMock: boolean;
  /** Human-readable configuration problems (never contain secret values). */
  issues: string[];
}

/** Total wall-clock budget for one request, below the 60 s serverless limit. */
export const TOTAL_BUDGET_MS = 55_000;

export function loadAiConfig(env: Record<string, string | undefined> = process.env): AiConfig {
  const parsed = EnvSchema.safeParse({
    AI_PROVIDER: emptyToUndefined(env.AI_PROVIDER),
    GEMINI_API_KEY: emptyToUndefined(env.GEMINI_API_KEY),
    GEMINI_MODEL: emptyToUndefined(env.GEMINI_MODEL),
    AI_TIMEOUT_MS: emptyToUndefined(env.AI_TIMEOUT_MS),
    AI_MAX_ATTEMPTS: emptyToUndefined(env.AI_MAX_ATTEMPTS),
    AI_FALLBACK_TO_MOCK: emptyToUndefined(env.AI_FALLBACK_TO_MOCK),
  });

  if (!parsed.success) {
    // Invalid configuration must not take the app down: report it and run in mock mode.
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "env"}: ${i.message}`);
    return { mode: "mock", provider: "mock", model: "mock", timeoutMs: 45_000, maxAttempts: 1, fallbackToMock: true, issues: ["Invalid AI configuration; using the mock provider.", ...issues] };
  }

  const e = parsed.data;
  const issues: string[] = [];
  const hasKey = Boolean(e.GEMINI_API_KEY);
  let provider: AiConfig["provider"] = "mock";
  if (e.AI_PROVIDER === "mock") provider = "mock";
  else if (hasKey) provider = "gemini";
  else if (e.AI_PROVIDER === "gemini") {
    // Explicit gemini without a key cannot work: mock answers (flagged in the UI) unless fallback is disabled.
    provider = "gemini";
    issues.push("AI_PROVIDER=gemini but GEMINI_API_KEY is not set.");
  }
  return {
    mode: e.AI_PROVIDER,
    provider,
    apiKey: e.GEMINI_API_KEY,
    model: e.GEMINI_MODEL,
    timeoutMs: e.AI_TIMEOUT_MS,
    maxAttempts: e.AI_MAX_ATTEMPTS,
    fallbackToMock: e.AI_FALLBACK_TO_MOCK,
    issues,
  };
}

/** Public, secret-free view of the configuration. */
export function toStatus(config: AiConfig): AiStatus {
  const usable = config.provider === "gemini" && Boolean(config.apiKey);
  return {
    provider: usable || (config.provider === "gemini" && config.fallbackToMock === false) ? "gemini" : "mock",
    model: config.provider === "mock" ? undefined : config.model,
    mode: config.mode,
    keyConfigured: Boolean(config.apiKey),
    fallbackToMock: config.fallbackToMock,
    issues: config.issues,
  };
}

function emptyToUndefined(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === "" ? undefined : value;
}
