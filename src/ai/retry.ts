import { AiError, toAiError } from "./errors";

export interface RetryOptions {
  /** Maximum number of attempts (1 = no retry). */
  attempts: number;
  /** Timeout of a single attempt. */
  timeoutMs: number;
  /** Wall-clock budget for all attempts together. */
  totalBudgetMs: number;
  baseDelayMs?: number;
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface RetryOutcome<T> {
  value: T;
  attempts: number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs `fn` with a per-attempt timeout (via AbortSignal), exponential backoff with jitter, and a total time budget.
 * Only retryable AiErrors are retried (429, 5xx, timeouts, malformed model output); others fail immediately.
 */
export async function withRetry<T>(fn: (signal: AbortSignal) => Promise<T>, options: RetryOptions): Promise<RetryOutcome<T>> {
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const base = options.baseDelayMs ?? 800;
  const started = now();
  let lastError: AiError | undefined;

  for (let attempt = 1; attempt <= options.attempts; attempt++) {
    const remaining = options.totalBudgetMs - (now() - started);
    if (remaining < 1000) break;
    const timeout = Math.min(options.timeoutMs, remaining);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const value = await fn(controller.signal);
      return { value, attempts: attempt };
    } catch (err) {
      const timedOut = controller.signal.aborted;
      lastError = timedOut ? new AiError("timeout", `The AI model did not answer within ${Math.round(timeout / 1000)} s.`, true) : toAiError(err);
      if (!lastError.retryable || attempt === options.attempts) break;
      const delay = Math.round(base * 2 ** (attempt - 1) * (0.75 + Math.random() * 0.5));
      if (options.totalBudgetMs - (now() - started) < delay + 1000) break;
      await sleep(delay);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError ?? new AiError("timeout", "The AI request ran out of time before it could start.", false);
}
