import type { AiStatus } from "./schemas";

/**
 * Reads the secret-free AI status from the server. Deliberately free of the validation library, so it can run
 * at startup without loading it: the shape is checked by hand (it is a tiny, flat object from our own server).
 */
export async function fetchAiStatus(fetchImpl: typeof fetch = fetch): Promise<AiStatus | null> {
  try {
    const res = await fetchImpl("/api/ai/status", { cache: "no-store" });
    if (!res.ok) return null;
    const v = (await res.json()) as Record<string, unknown>;
    const providerOk = v.provider === "gemini" || v.provider === "mock";
    const modeOk = v.mode === "auto" || v.mode === "gemini" || v.mode === "mock";
    if (!providerOk || !modeOk || typeof v.keyConfigured !== "boolean" || typeof v.fallbackToMock !== "boolean" || !Array.isArray(v.issues)) return null;
    return {
      provider: v.provider as AiStatus["provider"],
      model: typeof v.model === "string" ? v.model : undefined,
      mode: v.mode as AiStatus["mode"],
      keyConfigured: v.keyConfigured,
      fallbackToMock: v.fallbackToMock,
      issues: v.issues.filter((i): i is string => typeof i === "string"),
    };
  } catch {
    return null;
  }
}
