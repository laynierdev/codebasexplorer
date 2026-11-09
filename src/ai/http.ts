import { loadAiConfig, toStatus } from "./config";
import type { AiError } from "./errors";
import { parseAiRequest, runAiRequest, type RunDeps } from "./run";

/** Maximum accepted request body (a context pack is capped well below this by its schema). */
export const MAX_BODY_BYTES = 1_200_000;

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 30;
const hits = new Map<string, number[]>();

/** Best-effort in-memory limiter. On serverless each instance has its own counter, so this is a safety net, not a quota. */
export function rateLimited(key: string, now = Date.now()): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) for (const [k, v] of hits) if (v.every((t) => now - t >= WINDOW_MS)) hits.delete(k);
  return recent.length > MAX_REQUESTS_PER_WINDOW;
}

export function resetRateLimiter(): void {
  hits.clear();
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });
}

const errorBody = (code: string, message: string) => ({ error: { code, message } });

const STATUS_BY_CODE: Record<string, number> = { timeout: 504, "rate-limited": 503, quota: 503, unavailable: 502, auth: 502, "model-not-found": 502, blocked: 422, "bad-output": 502, config: 500 };

/** Rejects cross-site browser requests: the endpoint spends the server's API quota. */
function crossOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

/** POST /api/ai */
export async function handleAiPost(request: Request, deps: RunDeps = {}, env: Record<string, string | undefined> = process.env): Promise<Response> {
  if (crossOrigin(request)) return json(403, errorBody("forbidden", "Cross-origin requests are not allowed."));
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (rateLimited(ip)) return json(429, errorBody("rate-limited", "Too many requests. Please wait a minute."), { "retry-after": "60" });

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return json(413, errorBody("too-large", "The request is too large."));
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return json(413, errorBody("too-large", "The request is too large."));

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, errorBody("invalid-json", "The request body is not valid JSON."));
  }
  const parsed = parseAiRequest(body);
  if (!parsed.ok) return json(400, errorBody("invalid-request", parsed.message));

  const config = loadAiConfig(env);
  try {
    const response = await runAiRequest(config, parsed.request, deps);
    // Metadata only: repository content is never logged.
    console.info(`[ai] task=${parsed.request.task.task} provider=${response.provider} ms=${response.durationMs} attempts=${response.attempts}${response.fallback ? " fallback=" + response.fallback.code : ""}`);
    return json(200, response);
  } catch (err) {
    const e = err as AiError;
    const code = typeof e.code === "string" ? e.code : "unknown";
    console.warn(`[ai] task=${parsed.request.task.task} failed code=${code}`);
    return json(STATUS_BY_CODE[code] ?? 502, errorBody(code, e.message || "The AI request failed."));
  }
}

/** GET /api/ai/status */
export function handleAiStatus(env: Record<string, string | undefined> = process.env): Response {
  return json(200, toStatus(loadAiConfig(env)));
}
