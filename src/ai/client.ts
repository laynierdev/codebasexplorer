import type { AnswerBlock, AssistantMeta, Repository } from "@/domain/types";
import { buildContextPack } from "./context/pack";
import { describeReport, groundAnswer, groundDocs, groundSearch, type GroundedDoc, type GroundedSearchResult, type GroundingReport } from "./grounding";
import { AiResponseSchema, AiStatusSchema, type AiResponse, type AiStatus, type AiTask } from "./schemas";

/**
 * Browser side of the AI feature: selects context from the analyzed repository, calls the server route
 * (which holds the API key), validates the response and grounds it against the real source.
 */

export class AiClientError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "AiClientError";
  }
}

export interface AiCallOptions {
  selectedFile?: string;
  signal?: AbortSignal;
  /** Injected for tests. */
  fetchImpl?: typeof fetch;
  budgetChars?: number;
}

export type AiOutcome =
  | { kind: "answer"; blocks: AnswerBlock[]; meta: AssistantMeta; report: GroundingReport }
  | { kind: "docs"; doc: GroundedDoc; meta: AssistantMeta; report: GroundingReport }
  | { kind: "search"; results: GroundedSearchResult[]; note?: string; meta: AssistantMeta; report: GroundingReport };

const FRIENDLY: Record<string, string> = {
  timeout: "The AI model took too long to answer.",
  "rate-limited": "The AI service is busy or rate limited. Try again in a moment.",
  quota: "The Gemini quota is exhausted for now (free-tier limits reset daily). Try later or use a model/plan with a higher quota.",
  unavailable: "The AI service is temporarily unavailable.",
  auth: "The AI service rejected the server's credentials. Check GEMINI_API_KEY.",
  "model-not-found": "The configured Gemini model was not found. Check GEMINI_MODEL.",
  blocked: "The AI service declined to answer this request.",
  "bad-output": "The AI service returned an unusable answer.",
  config: "The AI service is not configured correctly.",
};

export async function askAi(repo: Repository, task: AiTask, options: AiCallOptions = {}): Promise<AiOutcome> {
  const context = buildContextPack(repo, task, { selectedFile: options.selectedFile, budgetChars: options.budgetChars });
  const doFetch = options.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await doFetch("/api/ai", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ task, context }), signal: options.signal });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw new AiClientError("The request was cancelled.", "aborted");
    throw new AiClientError("Could not reach the AI service. Check your connection and try again.", "network");
  }

  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    throw new AiClientError(`The AI service returned an unreadable response (HTTP ${res.status}).`, "bad-response");
  }
  if (!res.ok) {
    const err = (payload as { error?: { code?: string; message?: string } })?.error;
    const code = err?.code ?? "unknown";
    throw new AiClientError(FRIENDLY[code] ?? err?.message ?? `The AI request failed (HTTP ${res.status}).`, code);
  }

  const parsed = AiResponseSchema.safeParse(payload);
  if (!parsed.success) throw new AiClientError("The AI service returned an unexpected response format.", "bad-response");
  return ground(repo, parsed.data, context.truncated);
}

function ground(repo: Repository, response: AiResponse, truncated: boolean): AiOutcome {
  const baseMeta = (report: GroundingReport, extra: string[] = []): AssistantMeta => ({
    provider: response.provider,
    model: response.model,
    durationMs: response.durationMs,
    fallbackReason: response.fallback ? friendlyFallback(response.fallback.code, response.fallback.reason) : undefined,
    warnings: [...describeReport(report), ...extra],
    injectionSuspected: response.injectionSuspected,
    truncated,
  });
  const requireRefsForFacts = response.provider === "gemini";

  switch (response.result.kind) {
    case "answer": {
      const { blocks, report } = groundAnswer(repo, response.result.data, { requireRefsForFacts });
      return { kind: "answer", blocks, report, meta: baseMeta(report) };
    }
    case "docs": {
      const { doc, report } = groundDocs(repo, response.result.data);
      return { kind: "docs", doc, report, meta: baseMeta(report) };
    }
    case "search": {
      const { results, note, dropped } = groundSearch(repo, response.result.data);
      const report: GroundingReport = { droppedRefs: dropped, clampedRefs: 0, snappedRefs: 0, droppedSymbols: 0, downgradedFacts: 0, unverifiedMentions: [] };
      return { kind: "search", results, note, report, meta: baseMeta(report) };
    }
  }
}

function friendlyFallback(code: string, reason: string): string {
  return FRIENDLY[code] ?? reason;
}

/** Secret-free status of the AI backend (provider, model, whether a key exists). */
export async function fetchAiStatus(fetchImpl: typeof fetch = fetch): Promise<AiStatus | null> {
  try {
    const res = await fetchImpl("/api/ai/status", { cache: "no-store" });
    if (!res.ok) return null;
    const parsed = AiStatusSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
