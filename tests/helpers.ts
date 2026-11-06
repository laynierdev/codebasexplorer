import { zipSync } from "fflate";
import type { RawEntry } from "@/analysis/zip";

const encoder = new TextEncoder();

export function entriesFrom(files: Record<string, string>): RawEntry[] {
  return Object.entries(files).map(([path, content]) => ({ path, data: encoder.encode(content) }));
}

/** Builds a ZIP in memory from text files (or raw bytes). */
export function makeZip(files: Record<string, string | Uint8Array>, level: 0 | 6 = 6): Uint8Array {
  const input: Record<string, Uint8Array> = {};
  for (const [name, content] of Object.entries(files)) input[name] = typeof content === "string" ? encoder.encode(content) : content;
  return zipSync(input, { level });
}
