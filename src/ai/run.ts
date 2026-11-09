import { TOTAL_BUDGET_MS, type AiConfig } from "./config";
import { AiError, toAiError } from "./errors";
import { detectInjection } from "./prompts";
import type { AiProvider, AiProviderResult } from "./provider";
import { GeminiProvider } from "./providers/gemini";
import { MockProvider } from "./providers/mock";
import { withRetry } from "./retry";
import { AiRequestSchema, AiResponseSchema, type AiRequest, type AiResponse } from "./schemas";

export interface RunDeps {
  /** Injected for tests. */
  gemini?: AiProvider;
  mock?: AiProvider;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Runs one AI request under the configured policy: Gemini with a per-attempt timeout and bounded retries,
 * then (if allowed) the mock provider, with the fallback clearly flagged in the response.
 * Throws AiError only when Gemini fails and fallback is disabled.
 */
export async function runAiRequest(config: AiConfig, request: AiRequest, deps: RunDeps = {}): Promise<AiResponse> {
  const started = Date.now();
  const mock = deps.mock ?? new MockProvider();
  const injectionSuspected = detectInjection(request.context);
  const finish = (r: AiProviderResult, provider: "gemini" | "mock", attempts: number, fallback?: { reason: string; code: string }): AiResponse =>
    AiResponseSchema.parse({
      provider,
      model: r.model,
      mock: provider === "mock",
      fallback,
      durationMs: Date.now() - started,
      attempts,
      usage: r.usage,
      injectionSuspected,
      result: r.result,
    });

  if (config.provider === "mock") {
    return finish(await mock.run(request, new AbortController().signal), "mock", 0);
  }

  let failure: AiError;
  try {
    if (!config.apiKey && !deps.gemini) throw new AiError("config", "GEMINI_API_KEY is not configured.", false);
    const gemini = deps.gemini ?? new GeminiProvider({ apiKey: config.apiKey as string, model: config.model });
    const { value, attempts } = await withRetry((signal) => gemini.run(request, signal), {
      attempts: config.maxAttempts,
      timeoutMs: config.timeoutMs,
      totalBudgetMs: TOTAL_BUDGET_MS,
      sleep: deps.sleep,
    });
    return finish(value, "gemini", attempts);
  } catch (err) {
    failure = toAiError(err);
  }

  if (!config.fallbackToMock) throw failure;
  const fallback = await mock.run(request, new AbortController().signal);
  return finish(fallback, "mock", config.maxAttempts, { reason: failure.message, code: failure.code });
}

/** Parses an untrusted request body into a validated AiRequest. */
export function parseAiRequest(body: unknown): { ok: true; request: AiRequest } | { ok: false; message: string } {
  const parsed = AiRequestSchema.safeParse(body);
  if (parsed.success) return { ok: true, request: parsed.data };
  const first = parsed.error.issues[0];
  return { ok: false, message: `Invalid request: ${first?.path.join(".") || "body"}: ${first?.message ?? "invalid"}` };
}
