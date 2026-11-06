import type { Layer, SourceFile, SourceSymbol } from "@/domain/types";

const LAYER_NOUN: Record<Layer, string> = {
  entry: "Entry point",
  route: "Routing module",
  controller: "Controller",
  service: "Service",
  repository: "Data-access module",
  database: "Database module",
  middleware: "Middleware",
  config: "Configuration module",
  model: "Model/type definitions",
  test: "Test file",
  external: "External integration",
  component: "UI component",
  page: "Page or layout",
  util: "Utility module",
  other: "Source module",
};

/**
 * Short, deterministic description of a file from evidence only (name, layer, exported symbols).
 * It states what the file is, never guesses what it "does". Stage 3 adds AI-written explanations.
 */
export function describeFile(file: SourceFile, symbols: SourceSymbol[]): string {
  const name = file.name;
  if (/^package\.json$/.test(name)) return "Package manifest: dependencies and scripts.";
  if (/^tsconfig/.test(name) || name === "jsconfig.json") return "TypeScript/JavaScript compiler configuration.";
  if (/^\.env/.test(name)) return "Environment variable template or configuration.";
  if (name === "Dockerfile") return "Container image definition.";
  if (/^readme/i.test(name)) return "Project readme.";
  if (file.kind === "doc") return "Documentation.";
  if (file.kind === "config") return "Configuration file.";
  if (file.kind === "test") {
    const subject = name.replace(/\.(test|spec)\.[a-z]+$/i, "");
    return `Tests for ${subject}.`;
  }
  if (!file.parsed) return file.kind === "script" ? `Script (${file.language}), indexed as text only.` : `${capitalize(file.language)} file, indexed as text only.`;

  const exported = symbols.filter((s) => s.exported).map((s) => s.name);
  const noun = LAYER_NOUN[file.layer];
  if (exported.length === 0) return `${noun} (no exports).`;
  const shown = exported.slice(0, 4).join(", ");
  return `${noun} exporting ${shown}${exported.length > 4 ? ` and ${exported.length - 4} more` : ""}.`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
