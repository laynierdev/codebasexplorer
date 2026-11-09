import { GoogleGenAI, ThinkingLevel, type GenerateContentConfig } from "@google/genai";
import { z } from "zod";
import { AiError, toAiError } from "../errors";
import { buildUserPrompt, SYSTEM_INSTRUCTION } from "../prompts";
import type { AiProvider, AiProviderRequest, AiProviderResult } from "../provider";
import type { AiResult } from "../schemas";
import { outputFor } from "../tasks";

export interface GeminiOptions {
  apiKey: string;
  model: string;
  /** Injected for tests. */
  client?: Pick<GoogleGenAI, "models">;
}

/**
 * Keywords Gemini's structured-output schema rejects (HTTP 400 INVALID_ARGUMENT, verified against the live API).
 * They are removed from the schema sent to the model; Zod still enforces them when the answer is validated.
 */
const UNSUPPORTED_KEYWORDS = new Set(["$schema", "maximum", "maxLength", "minLength", "maxItems", "minItems"]);

function stripUnsupported(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripUnsupported);
  if (node && typeof node === "object") {
    return Object.fromEntries(
      Object.entries(node as Record<string, unknown>)
        .filter(([key]) => !UNSUPPORTED_KEYWORDS.has(key))
        .map(([key, value]) => [key, stripUnsupported(value)]),
    );
  }
  return node;
}

/** JSON Schema for the model's structured output, derived from the same Zod schema used to validate it. */
export function jsonSchemaFor(schema: z.ZodType): Record<string, unknown> {
  return stripUnsupported(z.toJSONSchema(schema)) as Record<string, unknown>;
}

function thinkingConfigFor(model: string): GenerateContentConfig["thinkingConfig"] | undefined {
  if (/gemini-3/i.test(model)) return { thinkingLevel: ThinkingLevel.LOW };
  if (/gemini-2\.5/i.test(model)) return { thinkingBudget: 1024 };
  return undefined;
}

function stripFences(text: string): string {
  const m = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/i.exec(text);
  return m ? (m[1] as string) : text;
}

/** Real Gemini provider. Runs server-side only; the API key never reaches the browser. */
export class GeminiProvider implements AiProvider {
  readonly id = "gemini" as const;
  private readonly client: Pick<GoogleGenAI, "models">;

  constructor(private readonly options: GeminiOptions) {
    this.client = options.client ?? new GoogleGenAI({ apiKey: options.apiKey });
  }

  async run({ task, context }: AiProviderRequest, signal: AbortSignal): Promise<AiProviderResult> {
    const { kind, schema } = outputFor(task);
    let response;
    try {
      response = await this.client.models.generateContent({
        model: this.options.model,
        contents: buildUserPrompt(task, context),
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseMimeType: "application/json",
          responseJsonSchema: jsonSchemaFor(schema),
          temperature: 0.2,
          maxOutputTokens: kind === "docs" ? 8192 : 4096,
          thinkingConfig: thinkingConfigFor(this.options.model),
          abortSignal: signal,
        },
      });
    } catch (err) {
      throw toAiError(err);
    }

    const blockReason = response.promptFeedback?.blockReason;
    if (blockReason) throw new AiError("blocked", `The AI service declined to process this request (${blockReason}).`, false);
    const finish = response.candidates?.[0]?.finishReason;
    if (finish && /SAFETY|RECITATION|PROHIBITED|BLOCKLIST|SPII/i.test(String(finish))) {
      throw new AiError("blocked", `The AI service stopped the answer (${finish}).`, false);
    }

    const text = response.text;
    if (!text) throw new AiError("bad-output", "The AI model returned an empty answer.", true);
    let json: unknown;
    try {
      json = JSON.parse(stripFences(text));
    } catch {
      throw new AiError("bad-output", finish === "MAX_TOKENS" ? "The AI answer was cut off." : "The AI model returned malformed JSON.", true);
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new AiError("bad-output", "The AI answer did not match the expected structure.", true);

    return {
      result: { kind, data: parsed.data } as AiResult,
      model: this.options.model,
      usage: { inputTokens: response.usageMetadata?.promptTokenCount, outputTokens: response.usageMetadata?.candidatesTokenCount },
    };
  }
}
