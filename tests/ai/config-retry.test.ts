import { describe, expect, it, vi } from "vitest";
import { loadAiConfig, toStatus } from "@/ai/config";
import { AiError, toAiError } from "@/ai/errors";
import { withRetry } from "@/ai/retry";

describe("loadAiConfig", () => {
  it("defaults to auto mode and the mock provider when no key is set", () => {
    const c = loadAiConfig({});
    expect(c).toMatchObject({ mode: "auto", provider: "mock", timeoutMs: 45_000, maxAttempts: 3, fallbackToMock: true, issues: [] });
  });

  it("uses Gemini in auto mode when a key is present", () => {
    const c = loadAiConfig({ GEMINI_API_KEY: "k", GEMINI_MODEL: "gemini-x" });
    expect(c).toMatchObject({ provider: "gemini", model: "gemini-x", apiKey: "k" });
  });

  it("never calls Gemini in mock mode even with a key", () => {
    expect(loadAiConfig({ AI_PROVIDER: "mock", GEMINI_API_KEY: "k" }).provider).toBe("mock");
  });

  it("flags an explicit gemini mode without a key", () => {
    const c = loadAiConfig({ AI_PROVIDER: "gemini" });
    expect(c.provider).toBe("gemini");
    expect(c.issues.join(" ")).toMatch(/GEMINI_API_KEY is not set/);
  });

  it("treats empty values as unset and parses booleans and numbers", () => {
    const c = loadAiConfig({ AI_PROVIDER: "", GEMINI_API_KEY: "  ", AI_TIMEOUT_MS: "20000", AI_MAX_ATTEMPTS: "2", AI_FALLBACK_TO_MOCK: "false" });
    expect(c).toMatchObject({ mode: "auto", provider: "mock", timeoutMs: 20_000, maxAttempts: 2, fallbackToMock: false });
  });

  it.each([{ AI_TIMEOUT_MS: "999999" }, { AI_MAX_ATTEMPTS: "9" }, { AI_PROVIDER: "openai" }, { AI_TIMEOUT_MS: "abc" }])("falls back to mock mode on invalid config %o", (env) => {
    const c = loadAiConfig({ GEMINI_API_KEY: "k", ...env });
    expect(c.provider).toBe("mock");
    expect(c.issues[0]).toMatch(/Invalid AI configuration/);
  });

  it("never exposes the API key in the public status", () => {
    const status = toStatus(loadAiConfig({ GEMINI_API_KEY: "super-secret-key" }));
    expect(JSON.stringify(status)).not.toContain("super-secret-key");
    expect(status).toMatchObject({ provider: "gemini", keyConfigured: true });
  });

  it("reports mock as the answering provider when the key is missing and fallback is allowed", () => {
    expect(toStatus(loadAiConfig({ AI_PROVIDER: "gemini" })).provider).toBe("mock");
    expect(toStatus(loadAiConfig({ AI_PROVIDER: "gemini", AI_FALLBACK_TO_MOCK: "false" })).provider).toBe("gemini");
  });
});

describe("toAiError", () => {
  it.each([
    [{ status: 429 }, "rate-limited", true],
    [{ status: 503 }, "unavailable", true],
    [{ status: 401 }, "auth", false],
    [{ status: 403 }, "auth", false],
    [{ status: 404 }, "model-not-found", false],
    [{ status: 400 }, "bad-output", false],
    [{ name: "AbortError" }, "aborted", false],
    [new Error("fetch failed"), "unavailable", true],
    [new Error("boom"), "unknown", false],
  ])("maps %o to %s", (input, code, retryable) => {
    const e = toAiError(input);
    expect(e.code).toBe(code);
    expect(e.retryable).toBe(retryable);
  });

  it("treats an exhausted daily quota as permanent so the mock can answer immediately", () => {
    const quota = toAiError(Object.assign(new Error('{"error":{"message":"Quota exceeded ... per day limit exceeded on Free Tier. Please retry in 12h42m20.99s."}}'), { status: 429 }));
    expect(quota).toMatchObject({ code: "quota", retryable: false });
    expect(quota.message).toMatch(/13 h/);
    expect(toAiError(Object.assign(new Error("Please retry in 25s"), { status: 429 }))).toMatchObject({ code: "rate-limited", retryable: true });
    expect(toAiError(Object.assign(new Error("Please retry in 2m5s"), { status: 429 })).code).toBe("quota");
  });

  it("does not leak the original message", () => {
    expect(toAiError(new Error("key=AIza-secret failed")).message).not.toContain("AIza");
  });
});

const instant = async () => undefined;

describe("withRetry", () => {
  it("returns on the first success", async () => {
    const r = await withRetry(async () => "ok", { attempts: 3, timeoutMs: 1000, totalBudgetMs: 10_000, sleep: instant });
    expect(r).toEqual({ value: "ok", attempts: 1 });
  });

  it("retries temporary failures and reports the attempt count", async () => {
    const fn = vi.fn().mockRejectedValueOnce({ status: 429 }).mockRejectedValueOnce({ status: 503 }).mockResolvedValueOnce("ok");
    const r = await withRetry(fn, { attempts: 3, timeoutMs: 1000, totalBudgetMs: 10_000, sleep: instant });
    expect(r).toEqual({ value: "ok", attempts: 3 });
  });

  it("retries malformed model output", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new AiError("bad-output", "bad", true)).mockResolvedValueOnce("fixed");
    expect((await withRetry(fn, { attempts: 2, timeoutMs: 1000, totalBudgetMs: 10_000, sleep: instant })).value).toBe("fixed");
  });

  it("does not retry permanent failures", async () => {
    const fn = vi.fn().mockRejectedValue({ status: 401 });
    await expect(withRetry(fn, { attempts: 4, timeoutMs: 1000, totalBudgetMs: 10_000, sleep: instant })).rejects.toMatchObject({ code: "auth" });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("gives up after the maximum attempts with the last error", async () => {
    const fn = vi.fn().mockRejectedValue({ status: 503 });
    await expect(withRetry(fn, { attempts: 3, timeoutMs: 1000, totalBudgetMs: 10_000, sleep: instant })).rejects.toMatchObject({ code: "unavailable" });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("aborts a call that exceeds the timeout and reports it as a timeout", async () => {
    const fn = (signal: AbortSignal) => new Promise<string>((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
    await expect(withRetry(fn, { attempts: 1, timeoutMs: 1000, totalBudgetMs: 10_000, sleep: instant })).rejects.toMatchObject({ code: "timeout" });
  }, 5000);

  it("stops retrying when the total time budget is spent", async () => {
    let clock = 0;
    const fn = vi.fn().mockImplementation(async () => {
      clock += 40_000;
      throw { status: 503 };
    });
    await expect(withRetry(fn, { attempts: 4, timeoutMs: 45_000, totalBudgetMs: 55_000, sleep: instant, now: () => clock })).rejects.toBeInstanceOf(AiError);
    expect(fn.mock.calls.length).toBeLessThan(4);
  });
});
