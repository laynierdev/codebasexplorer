import type { AnalysisLimits, SkippedItem } from "@/domain/types";
import { IgnoreRules, ScanPlanner } from "./ignore";
import { ArchiveError } from "./limits";
import type { RawEntry } from "./zip";

/** A file chosen through a folder picker, with its path relative to the picked folder. */
export interface PickedFile {
  path: string;
  size: number;
  read: () => Promise<ArrayBuffer>;
}

/**
 * Applies the same scan plan as ZIP import to a picked folder: ignored directories and
 * oversized files are never read into memory, and every skipped item is reported.
 */
export async function collectFolderEntries(picked: PickedFile[], limits: AnalysisLimits): Promise<{ entries: RawEntry[]; skipped: SkippedItem[] }> {
  if (picked.length === 0) throw new ArchiveError("empty", "The selected folder contains no files.");
  if (picked.length > limits.maxEntries) throw new ArchiveError("too-many-entries", `The folder has more than ${limits.maxEntries} files.`);

  const gitignoreTexts = new Map<string, string>();
  const decoder = new TextDecoder();
  for (const f of picked) {
    if (f.path === ".gitignore" || f.path.endsWith("/.gitignore")) {
      if (f.size > 256 * 1024) continue;
      const dir = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : "";
      gitignoreTexts.set(dir, decoder.decode(await f.read()));
    }
  }

  const planner = new ScanPlanner(limits, new IgnoreRules(limits, gitignoreTexts));
  const entries: RawEntry[] = [];
  let total = 0;
  for (const f of picked) {
    if (!planner.decide(f.path, f.size).include) continue;
    total += f.size;
    if (total > limits.maxTotalBytes) throw new ArchiveError("uncompressed-too-large", "The folder's analyzable content is too large.");
    entries.push({ path: f.path, data: new Uint8Array(await f.read()) });
  }
  return { entries, skipped: planner.skipped() };
}
