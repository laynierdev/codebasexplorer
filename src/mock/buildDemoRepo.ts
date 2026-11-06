import { analyzeEntries } from "@/analysis/analyze";
import type { RawEntry } from "@/analysis/zip";
import type { Repository, SkippedItem } from "@/domain/types";
import { DEMO_FLOWS } from "./demoFlows";
import { DEMO_PURPOSES, DEMO_SKIPPED, DEMO_SOURCES } from "./demoSources";

/**
 * The bundled demo repository is produced by the REAL analyzer from embedded sources.
 * Only three things are hand-authored on top: richer file purposes, curated execution flows
 * (with inferred steps), and a sample of what the scanner would skip in a real ZIP.
 */
function buildDemoRepository(): Repository {
  const encoder = new TextEncoder();
  const entries: RawEntry[] = Object.entries(DEMO_SOURCES).map(([path, content]) => ({ path, data: encoder.encode(content) }));
  const repo = analyzeEntries(entries, { name: "acme-shop-api" });

  for (const file of repo.files) file.purpose = DEMO_PURPOSES[file.path] ?? file.purpose;
  const sampleSkipped = DEMO_SKIPPED.map((s) => ({ ...s })) as SkippedItem[];

  return {
    ...repo,
    description: "REST API for an online shop: authentication, product catalog and orders.",
    flows: DEMO_FLOWS,
    skipped: sampleSkipped,
    analysis: {
      ...repo.analysis,
      status: "partial",
      skippedFiles: sampleSkipped.reduce((s, i) => s + (i.fileCount ?? 1), 0),
    },
  };
}

export const demoRepository: Repository = buildDemoRepository();
