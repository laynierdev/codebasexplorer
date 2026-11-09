import type { AiResult, AiTask, ContextPack } from "./schemas";

export interface AiProviderRequest {
  task: AiTask;
  context: ContextPack;
}

export interface AiProviderResult {
  result: AiResult;
  model?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

/**
 * Abstraction over the model backend so the real Gemini integration and the mock coexist.
 * Implementations must not execute anything from the context pack and must honor `signal`.
 */
export interface AiProvider {
  readonly id: "gemini" | "mock";
  run(request: AiProviderRequest, signal: AbortSignal): Promise<AiProviderResult>;
}
