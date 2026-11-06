import type { AnalysisLimits, Repository, SkippedItem } from "@/domain/types";
import type { RawEntry } from "../zip";

/** Messages between the UI thread and the analysis Web Worker. Repository code is never executed in either. */
export type WorkerRequest =
  | { type: "analyze-zip"; bytes: ArrayBuffer; name: string; limits: AnalysisLimits }
  | { type: "analyze-entries"; entries: RawEntry[]; skipped: SkippedItem[]; name: string; limits: AnalysisLimits };

export type WorkerResponse =
  | { type: "progress"; stage: string; done: number; total: number }
  | { type: "result"; repository: Repository }
  | { type: "error"; code: string; message: string };
