import { handleAiStatus } from "@/ai/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): Response {
  return handleAiStatus();
}
