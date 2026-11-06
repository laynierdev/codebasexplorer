import type { Repository } from "@/domain/types";
import { buildGraphIndex, findCycles, LAYER_LABEL, layerOf } from "@/lib/graph/analysis";
import { EXTERNAL_SYSTEMS } from "@/analysis/technologies";
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
    "- Entry points: " + (repo.entryPoints.map((e) => "`" + e.path + "` (" + e.reason + ")").join(", ") || "none detected"),
    "",
    repo.skipped.length ? "Skipped during analysis: " + repo.skipped.map((s) => "`" + s.path + "`").join(", ") + "." : "Nothing was skipped during analysis.",
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
    externalsLine(repo),
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
    ...(repo.flows.length ? [] : ["No execution flows were detected.", ""]),
    ...repo.flows.flatMap((flow) => [
      "## " + flow.title + " (`" + flow.trigger + "`)",
      flow.summary,
      "",
      ...flow.steps.map((s, i) => {
        const sym = s.startLine ? undefined : findSymbol(repo, s.file, s.symbol);
        const start = s.startLine ?? sym?.startLine;
        const end = s.endLine ?? sym?.endLine;
        const where = start ? s.file + ":" + start + (end && end !== start ? "-" + end : "") : s.file;
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

  const manifest = repo.files.find((f) => f.path === "package.json");
  const scripts = manifest ? readScripts(manifest.content) : {};
  const envFile = repo.files.find((f) => f.name === ".env.example" || f.name === ".env.sample");
  const firstEntry = repo.entryPoints[0]?.path;
  const onboarding = [
    "# Developer onboarding guide",
    "",
    ...numbered([
      envFile ? "Copy `" + envFile.path + "` to `.env` and fill in the values." : undefined,
      Object.keys(scripts).length ? "Install dependencies and use the package scripts: " + Object.keys(scripts).map((k) => "`" + k + "`").join(", ") + "." : undefined,
      firstEntry ? "Start reading at `" + firstEntry + "`." : "No entry point was detected; start from the most imported files listed in the dependency summary.",
      repo.flows[0] ? "Follow the *" + repo.flows[0].title + "* flow end to end." : undefined,
      "Use the dependency summary to see which files are most central before changing them.",
    ]),
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

function externalsLine(repo: Repository): string {
  const labels = new Set<string>();
  for (const usage of repo.externalUsages) {
    const system = EXTERNAL_SYSTEMS.find((s) => s.packages.includes(usage.package));
    if (system) labels.add(system.label + " (`" + usage.package + "`)");
  }
  return labels.size ? "External systems (from imported packages): " + [...labels].join(", ") + "." : "No external systems were detected from imported packages.";
}

function readScripts(manifest: string): Record<string, string> {
  try {
    return (JSON.parse(manifest) as { scripts?: Record<string, string> }).scripts ?? {};
  } catch {
    return {};
  }
}

function numbered(items: (string | undefined)[]): string[] {
  return items.filter((i): i is string => Boolean(i)).map((text, i) => i + 1 + ". " + text);
}
