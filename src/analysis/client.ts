import type { AnalysisLimits, Repository } from "@/domain/types";
import { validateRepository } from "./validate";
import { collectFolderEntries, type PickedFile } from "./folder";
import { ArchiveError } from "./limits";
import type { WorkerRequest, WorkerResponse } from "./worker/protocol";
import type { ArchiveErrorCode } from "./limits";

export type ProgressHandler = (stage: string, done: number, total: number) => void;

/** Error with a user-presentable message, raised for rejected archives and analysis failures. */
export class AnalysisError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "AnalysisError";
  }
}

function runWorker(request: WorkerRequest, transfer: Transferable[], onProgress?: ProgressHandler): Promise<Repository> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./worker/analysis.worker.ts", import.meta.url), { type: "module" });
    const finish = () => worker.terminate();
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data;
      if (msg.type === "progress") {
        onProgress?.(msg.stage, msg.done, msg.total);
      } else if (msg.type === "result") {
        finish();
        try {
          resolve(validateRepository(msg.repository)); // trust boundary: validate what the worker produced
        } catch (err) {
          reject(new AnalysisError(`The analysis result was invalid: ${err instanceof Error ? err.message : String(err)}`, "invalid-result"));
        }
      } else {
        finish();
        reject(new AnalysisError(msg.message, msg.code));
      }
    };
    worker.onerror = (event) => {
      finish();
      reject(new AnalysisError(event.message || "The analysis worker crashed.", "worker-crashed"));
    };
    worker.postMessage(request, transfer);
  });
}

export async function analyzeZipFile(file: File, limits: AnalysisLimits, onProgress?: ProgressHandler): Promise<Repository> {
  if (!file.name.toLowerCase().endsWith(".zip")) throw new AnalysisError("Only .zip archives are supported.", "not-a-zip" satisfies ArchiveErrorCode);
  if (file.size > limits.maxArchiveBytes) {
    throw new AnalysisError(`Archive is ${(file.size / 1048576).toFixed(1)} MB; the limit is ${(limits.maxArchiveBytes / 1048576).toFixed(1)} MB (Settings).`, "archive-too-large" satisfies ArchiveErrorCode);
  }
  const bytes = await file.arrayBuffer();
  return runWorker({ type: "analyze-zip", bytes, name: file.name.replace(/\.zip$/i, ""), limits }, [bytes], onProgress);
}

/** Analyzes files chosen with a folder picker (`<input webkitdirectory>`). Paths are made relative to the folder. */
export async function analyzeFolderFiles(files: File[], limits: AnalysisLimits, onProgress?: ProgressHandler): Promise<Repository> {
  const first = (files[0] as (File & { webkitRelativePath?: string }) | undefined)?.webkitRelativePath ?? "";
  const folderName = first.split("/")[0] || "folder";
  const picked: PickedFile[] = files.map((f) => {
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath ?? f.name;
    return { path: rel.split("/").slice(1).join("/") || f.name, size: f.size, read: () => f.arrayBuffer() };
  });
  onProgress?.("Reading folder", 0, picked.length);
  try {
    const { entries, skipped } = await collectFolderEntries(picked, limits);
    return await runWorker({ type: "analyze-entries", entries, skipped, name: folderName, limits }, entries.map((e) => e.data.buffer as ArrayBuffer), onProgress);
  } catch (err) {
    if (err instanceof ArchiveError) throw new AnalysisError(err.message, err.code);
    throw err;
  }
}
