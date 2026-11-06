import type { Repository } from "@/domain/types";
import { buildGraphIndex, findCycles, LAYER_LABEL, layerOf } from "@/lib/graph/analysis";
import { DEMO_FLOWS } from "@/mock/demoFlows";
import { findSymbol } from "@/lib/repo/refs";

export interface DocSection {
  id: string;
  title: string;
  markdown: string;
}

/**
 * Documentation built only from analyzed facts (MOCK generation: deterministic templates).
 * Stage 3 adds AI-written prose on top while keeping these facts as grounding.
 */
export function generateDocs(repo: Repository): DocSection[] {
  const index = buildGraphIndex(repo);
  const cycles = findCycles(repo);

  const overview = [
    "# " + repo.name,
    "",
    repo.description,
    "",
    "- Files analyzed: " + repo.analysis.analyzedFiles + " (" + repo.analysis.parsedFiles + " parsed for symbols and dependencies)",
    "- Languages: " + repo.languages.map((l) => l.language + " (" + l.files + ")").join(", "),
    "- Technologies: " + repo.technologies.join(", "),
    "- Entry point: " + repo.entryPoints.map((e) => "`" + e + "`").join(", "),
    "",
    "Skipped during analysis: " + repo.skipped.map((s) => "`" + s.path + "`").join(", ") + ".",
  ].join("\n");

  const layers = new Map<string, string[]>();
  for (const f of repo.files) {
    if (!f.parsed) continue;
    const label = LAYER_LABEL[layerOf(f.path)];
    layers.set(label, [...(layers.get(label) ?? []), f.path]);
  }
  const architecture = [
    "# Architecture overview",
    "",
    "Layers detected from the directory structure and imports:",
    "",
    ...[...layers.entries()].map(([label, paths]) => "- **" + label + "**: " + paths.map((p) => "`" + p + "`").join(", ")),
    "",
    "External systems (from imported packages): PostgreSQL (`pg`), Stripe (`stripe`), SMTP (`nodemailer`).",
    "",
    cycles.length ? "Circular dependencies: " + cycles.map((c) => c.map((p) => "`" + p + "`").join(" ⇄ ")).join("; ") + "." : "No circular dependencies detected.",
  ].join("\n");

  const modules = [
    "# Module documentation",
    "",
    ...repo.files
      .filter((f) => f.parsed && layerOf(f.path) !== "test")
      .flatMap((f) => {
        const symbols = repo.symbols.filter((s) => s.file === f.path && s.exported);
        return [
          "## `" + f.path + "`",
          f.purpose,
          "",
          symbols.length ? "Exports: " + symbols.map((s) => "`" + s.name + "` (" + s.kind + ", lines " + s.startLine + "-" + s.endLine + ")").join(", ") : "No exports.",
          "Imports: " + ((index.outgoing.get(f.path) ?? []).map((p) => "`" + p + "`").join(", ") || "none"),
          "",
        ];
      }),
  ].join("\n");

  const api = [
    "# API overview",
    "",
    "| Method | Path | Handler | Source |",
    "| --- | --- | --- | --- |",
    ...repo.endpoints.map((e) => "| " + e.method + " | `" + e.path + "` | " + (e.handler ? "`" + e.handler + "`" : "-") + " | `" + e.file + ":" + e.line + "` |"),
  ].join("\n");

  const flows = [
    "# Important execution flows",
    "",
    ...DEMO_FLOWS.flatMap((flow) => [
      "## " + flow.title + " (`" + flow.trigger + "`)",
      flow.summary,
      "",
      ...flow.steps.map((s, i) => {
        const sym = findSymbol(repo, s.file, s.symbol);
        const where = sym ? s.file + ":" + sym.startLine + "-" + sym.endLine : s.file;
        return i + 1 + ". " + s.title + " — `" + where + "`" + (s.evidence === "inferred" ? " _(inference)_" : "");
      }),
      "",
    ]),
  ].join("\n");

  const deps = [
    "# Dependency summary",
    "",
    "## Most depended-on files",
    ...[...index.incoming.entries()]
      .filter(([, from]) => from.length > 0)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 6)
      .map(([file, from]) => "- `" + file + "` — imported by " + from.length + " file(s)"),
    "",
    "## External packages",
    ...repo.externalDependencies.map((d) => "- `" + d.name + "` " + d.version + (d.dev ? " (dev)" : "")),
  ].join("\n");

  const onboarding = [
    "# Developer onboarding guide",
    "",
    "1. Copy `.env.example` to `.env` and fill in the values.",
    "2. Create the schema with `scripts/seed.sql`.",
    "3. Run `npm install` and `npm run dev`.",
    "4. Read `src/server.ts`, then `src/app.ts` and `src/routes/index.ts`.",
    "5. Follow the *Place an order* flow end to end.",
    "6. To add a feature: route → controller → service → repository, plus a test in `tests/`.",
  ].join("\n");

  return [
    { id: "overview", title: "Project overview", markdown: overview },
    { id: "architecture", title: "Architecture overview", markdown: architecture },
    { id: "modules", title: "Module documentation", markdown: modules },
    { id: "api", title: "API overview", markdown: api },
    { id: "flows", title: "Execution flows", markdown: flows },
    { id: "dependencies", title: "Dependency summary", markdown: deps },
    { id: "onboarding", title: "Onboarding guide", markdown: onboarding },
  ];
}
