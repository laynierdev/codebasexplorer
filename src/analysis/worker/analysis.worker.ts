/// <reference lib="webworker" />
import { analyzeEntries, analyzeZip } from "../analyze";
import { ArchiveError } from "../limits";
import type { WorkerRequest, WorkerResponse } from "./protocol";

const post = (message: WorkerResponse) => self.postMessage(message);

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  const onProgress = (stage: string, done: number, total: number) => post({ type: "progress", stage, done, total });
  try {
    const repository =
      request.type === "analyze-zip"
        ? analyzeZip(new Uint8Array(request.bytes), { name: request.name, limits: request.limits, onProgress })
        : analyzeEntries(request.entries, { name: request.name, limits: request.limits, skipped: request.skipped, onProgress });
    post({ type: "result", repository });
  } catch (err) {
    if (err instanceof ArchiveError) post({ type: "error", code: err.code, message: err.message });
    else post({ type: "error", code: "analysis-failed", message: err instanceof Error ? err.message : String(err) });
  }
};
