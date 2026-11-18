import { describe, expect, it } from "vitest";
import { fetchAiStatus } from "@/ai/status";

const respond = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
const good = { provider: "gemini", model: "gemini-x", mode: "auto", keyConfigured: true, fallbackToMock: true, issues: ["a"] };

describe("fetchAiStatus (lightweight, no validation library)", () => {
  it("returns a valid status", async () => {
    expect(await fetchAiStatus(respond(200, good))).toEqual(good);
  });

  it("tolerates a missing model and drops non-string issues", async () => {
    const status = await fetchAiStatus(respond(200, { ...good, model: undefined, issues: ["ok", 5, null] }));
    expect(status).toMatchObject({ model: undefined, issues: ["ok"] });
  });

  it.each([
    ["wrong provider", { ...good, provider: "openai" }],
    ["wrong mode", { ...good, mode: "x" }],
    ["missing flags", { provider: "mock", mode: "mock" }],
    ["issues not an array", { ...good, issues: "nope" }],
  ])("rejects %s", async (_n, body) => {
    expect(await fetchAiStatus(respond(200, body))).toBeNull();
  });

  it("returns null on HTTP errors, network failures and invalid JSON", async () => {
    expect(await fetchAiStatus(respond(500, good))).toBeNull();
    expect(await fetchAiStatus((async () => Promise.reject(new TypeError("fetch failed"))) as unknown as typeof fetch)).toBeNull();
    expect(await fetchAiStatus((async () => new Response("<html>", { status: 200 })) as unknown as typeof fetch)).toBeNull();
  });
});
