export type AiErrorCode =
  | "timeout"
  | "rate-limited"
  | "quota"
  | "unavailable"
  | "auth"
  | "model-not-found"
  | "blocked"
  | "bad-output"
  | "config"
  | "aborted"
  | "unknown";

/** Failure of an AI provider call. `retryable` tells the retry policy whether another attempt can help. */
export class AiError extends Error {
  constructor(
    public readonly code: AiErrorCode,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "AiError";
  }
}

/** Maps an unknown error thrown by an SDK/network call to an AiError without leaking details such as keys. */
export function toAiError(err: unknown): AiError {
  if (err instanceof AiError) return err;
  const status = typeof (err as { status?: unknown })?.status === "number" ? (err as { status: number }).status : undefined;
  const name = (err as { name?: string })?.name;
  if (name === "AbortError") return new AiError("aborted", "The request was aborted or timed out.", false);
  if (status === 429) {
    // A daily/billing quota will not recover within a request's time budget: do not retry, fall back right away.
    const retryAfter = retryDelaySeconds(String((err as Error)?.message ?? ""));
    if (/per day|PerDay|daily/i.test(String((err as Error)?.message ?? "")) || (retryAfter !== undefined && retryAfter > 60)) {
      return new AiError("quota", "The Gemini quota is exhausted for now" + (retryAfter ? " (it resets in about " + formatWait(retryAfter) + ")" : "") + ".", false);
    }
    return new AiError("rate-limited", "The AI service is rate limiting requests.", true);
  }
  if (status !== undefined && status >= 500) return new AiError("unavailable", `The AI service is temporarily unavailable (HTTP ${status}).`, true);
  if (status === 401 || status === 403) return new AiError("auth", "The AI service rejected the credentials.", false);
  if (status === 404) return new AiError("model-not-found", "The configured model was not found.", false);
  if (status === 400) return new AiError("bad-output", "The AI service rejected the request.", false);
  // Network-level failures (DNS, connection reset) have no status and are usually transient.
  if (/fetch failed|network|ECONN|ENOTFOUND|ETIMEDOUT|socket/i.test(String((err as Error)?.message))) {
    return new AiError("unavailable", "The AI service could not be reached.", true);
  }
  return new AiError("unknown", "The AI request failed.", false);
}

/** Seconds from "Please retry in 12h42m20.99s" style messages, if present. */
function retryDelaySeconds(message: string): number | undefined {
  const m = /retry in (?:(\d+)h)?(?:(\d+)m)?(?:([\d.]+)s)?/i.exec(message);
  if (!m || (!m[1] && !m[2] && !m[3])) return undefined;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

function formatWait(seconds: number): string {
  if (seconds >= 3600) return Math.round(seconds / 3600) + " h";
  if (seconds >= 60) return Math.round(seconds / 60) + " min";
  return Math.round(seconds) + " s";
}
