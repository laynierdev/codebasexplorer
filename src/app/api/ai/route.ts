import { handleAiPost } from "@/ai/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Gemini calls can take a while; stay below typical serverless limits (see TOTAL_BUDGET_MS).
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  return handleAiPost(request);
}
