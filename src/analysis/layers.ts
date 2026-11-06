import type { Language, Layer } from "@/domain/types";

/**
 * Heuristic architectural layer of a file, from its path. Deterministic and explainable:
 * the directory/file name is the evidence. It is a classification aid, not a guarantee.
 */
const DIR_LAYER: [RegExp, Layer][] = [
  [/^(routes?|routers?)$/, "route"],
  [/^(controllers?|handlers?)$/, "controller"],
  [/^(services?|usecases?|use-cases?)$/, "service"],
  [/^(repositories|repository|repos|dao|daos)$/, "repository"],
  [/^(db|database|prisma|migrations|drizzle)$/, "database"],
  [/^(middlewares?)$/, "middleware"],
  [/^(config|configs|configuration|settings)$/, "config"],
  [/^(models?|entities|entity|schemas?|types|domain|dto|dtos)$/, "model"],
  [/^(components?|ui|views?|widgets?)$/, "component"],
  [/^(hooks?|lib|libs|utils?|helpers?|shared|common)$/, "util"],
];

const TEST_PATH = /(^|\/)(tests?|__tests__|spec|e2e)\//i;
const TEST_FILE = /\.(test|spec)\.[a-z]+$/i;
const ENTRY_NAMES = new Set(["server", "main", "app", "index", "cli", "bootstrap", "start", "manage", "__main__"]);

export function classifyLayer(path: string, language?: Language): Layer {
  if (TEST_PATH.test(path) || TEST_FILE.test(path)) return "test";
  const parts = path.split("/");
  const file = parts[parts.length - 1] as string;
  const stem = file.replace(/\.[^.]+$/, "");
  const dirs = parts.slice(0, -1);

  // Framework file conventions first (Next.js app router and pages router).
  if (/^route\.(ts|js|tsx|jsx)$/.test(file)) return "route";
  if (/^(page|layout|loading|error|not-found|template)\.(tsx|jsx|ts|js)$/.test(file)) return "page";
  if (dirs.includes("pages") && /\.(tsx|jsx)$/.test(file)) return "page";
  if (dirs.includes("pages") && dirs.includes("api")) return "route";

  // Directory names, nearest directory first.
  for (let i = dirs.length - 1; i >= 0; i--) {
    const dir = (dirs[i] as string).toLowerCase();
    for (const [re, layer] of DIR_LAYER) if (re.test(dir)) return layer;
  }

  // File names such as user.controller.ts, auth.service.ts, order.repository.ts.
  const suffix = /\.(route|router|controller|service|repository|middleware|model|entity|config)\.[a-z]+$/.exec(file)?.[1];
  if (suffix) {
    const map: Record<string, Layer> = { route: "route", router: "route", controller: "controller", service: "service", repository: "repository", middleware: "middleware", model: "model", entity: "model", config: "config" };
    return map[suffix] ?? "other";
  }

  // Entry points: well-known names near the root.
  const isCode = language === undefined || language === "typescript" || language === "javascript" || language === "python" || language === "go";
  if (isCode && ENTRY_NAMES.has(stem) && dirs.filter((d) => d !== "src" && d !== "cmd").length === 0) return "entry";
  return "other";
}

export const LAYER_LABEL: Record<Layer, string> = {
  entry: "Entry",
  route: "Routes",
  controller: "Controllers",
  service: "Services",
  repository: "Repositories",
  database: "Database",
  middleware: "Middleware",
  config: "Config",
  model: "Models",
  test: "Tests",
  external: "External",
  component: "Components",
  page: "Pages",
  util: "Utilities",
  other: "Other",
};
