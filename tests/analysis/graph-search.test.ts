import { describe, expect, it } from "vitest";
import { analyzeEntries, validateRepository } from "@/analysis/analyze";
import { buildFileGraph, buildModuleGraph, buildNeighborhood } from "@/analysis/architecture";
import { SearchResultSchema } from "@/domain/schemas";
import { buildGraphIndex, computeImpact, endpointsServedBy, findCycles, findLayerViolations } from "@/lib/graph/analysis";
import { searchRepository } from "@/lib/search";
import { DEMO_SOURCES } from "@/mock/demoSources";
import { entriesFrom } from "../helpers";

const repo = analyzeEntries(entriesFrom(DEMO_SOURCES), { name: "acme-shop-api" });

describe("dependency graph", () => {
  it("indexes incoming and outgoing edges without duplicates", () => {
    const index = buildGraphIndex(repo);
    expect(index.incoming.get("src/services/payment.service.ts")).toEqual(["src/services/order.service.ts", "tests/order.service.test.ts"]);
    expect(index.outgoing.get("src/routes/orders.routes.ts")?.sort()).toEqual(["src/controllers/orders.controller.ts", "src/middleware/auth.middleware.ts"]);
  });

  it("finds circular dependencies", () => {
    expect(findCycles(repo)).toEqual([["src/services/auth.service.ts", "src/services/email.service.ts"]]);
  });

  it("finds no cycles in acyclic code", () => {
    const acyclic = analyzeEntries(entriesFrom({ "a.ts": "import './b';\n", "b.ts": "import './c';\n", "c.ts": "export const c = 1;\n" }));
    expect(findCycles(acyclic)).toEqual([]);
  });

  it("finds larger cycles and self-contained components", () => {
    const cyc = analyzeEntries(entriesFrom({ "a.ts": "import './b';\n", "b.ts": "import './c';\n", "c.ts": "import './a';\nexport const c = 1;\n", "d.ts": "import './a';\n" }));
    expect(findCycles(cyc)).toEqual([["a.ts", "b.ts", "c.ts"]]);
  });

  it("flags services importing from the HTTP middleware layer", () => {
    const violations = findLayerViolations(repo).filter((v) => v.message.startsWith("Service imports"));
    expect(violations.map((v) => v.from).sort()).toEqual([
      "src/services/auth.service.ts",
      "src/services/order.service.ts",
      "src/services/payment.service.ts",
      "src/services/product.service.ts",
    ]);
  });
});

describe("impact analysis", () => {
  it("separates direct and transitive dependents and finds tests and routes", () => {
    const impact = computeImpact(repo, "src/services/payment.service.ts");
    expect(impact.directDependents).toEqual(["src/services/order.service.ts", "tests/order.service.test.ts"]);
    expect(impact.transitiveDependents).toEqual(
      expect.arrayContaining(["src/controllers/orders.controller.ts", "src/routes/orders.routes.ts", "src/routes/index.ts", "src/app.ts", "src/server.ts"]),
    );
    expect(impact.affectedTests).toEqual(["tests/order.service.test.ts"]);
    expect(impact.affectedRoutes.map((e) => `${e.method} ${e.path}`).sort()).toEqual(["GET /api/orders/:id", "POST /api/orders"]);
    expect(impact.dependencies).toEqual(expect.arrayContaining(["src/config/env.ts", "src/repositories/order.repository.ts"]));
  });

  it("does not include the target among its own dependents, even in cycles", () => {
    const impact = computeImpact(repo, "src/services/auth.service.ts");
    expect(impact.directDependents).toContain("src/services/email.service.ts");
    expect([...impact.directDependents, ...impact.transitiveDependents]).not.toContain("src/services/auth.service.ts");
    expect(impact.cycles).toHaveLength(1);
  });

  it("reports nothing for an unused leaf", () => {
    const impact = computeImpact(repo, "tests/order.service.test.ts");
    expect(impact.directDependents).toEqual([]);
    expect(impact.affectedTests).toEqual([]);
  });

  it("finds endpoints served by a file", () => {
    expect(endpointsServedBy(repo, "src/repositories/product.repository.ts").map((e) => e.path)).toEqual(expect.arrayContaining(["/api/products", "/api/orders"]));
  });
});

describe("architecture graph", () => {
  const graph = buildFileGraph(repo);

  it("derives nodes from files and omits models and tests", () => {
    const ids = graph.nodes.map((n) => n.id);
    expect(ids).toContain("src/services/order.service.ts");
    expect(ids).not.toContain("src/models/types.ts");
    expect(ids.some((i) => i.startsWith("tests/"))).toBe(false);
  });

  it("derives external systems from package usage and marks those edges as declared", () => {
    expect(graph.nodes.filter((n) => n.layer === "external").map((n) => n.label).sort()).toEqual(["PostgreSQL", "SMTP server", "Stripe API"]);
    const stripe = graph.edges.find((e) => e.target === "ext:stripe");
    expect(stripe).toMatchObject({ source: "src/services/payment.service.ts", evidence: "declared", label: "stripe" });
  });

  it("only has edges between existing nodes", () => {
    const ids = new Set(graph.nodes.map((n) => n.id));
    expect(graph.edges.every((e) => ids.has(e.source) && ids.has(e.target))).toBe(true);
  });

  it("caps the number of nodes and reports how many were omitted", () => {
    const capped = buildFileGraph(repo, 5);
    expect(capped.nodes).toHaveLength(5);
    expect(capped.omitted).toBe(graph.nodes.length - 5);
  });

  it("aggregates a module-level view by directory with weights", () => {
    const modules = buildModuleGraph(repo);
    expect(modules.nodes.map((n) => n.label)).toEqual(
      expect.arrayContaining(["src/routes", "src/controllers", "src/services", "src/repositories", "PostgreSQL", "Stripe API", "SMTP server"]),
    );
    expect(modules.nodes.find((n) => n.label === "src/services")).toMatchObject({ layer: "service", description: expect.stringContaining("5 file(s)") });
    const controllersToServices = modules.edges.find((e) => e.id === "module:src/controllers->module:src/services");
    expect(controllersToServices?.label).toBe("3"); // one import per controller (auth, products, orders)
    expect(modules.edges.find((e) => e.id === "module:src/services->module:src/controllers")).toBeUndefined();
    expect(modules.edges.find((e) => e.target === "ext:stripe")).toMatchObject({ source: "module:src/services", evidence: "declared" });
    expect(modules.nodes.some((n) => n.label === "tests")).toBe(false);
  });

  it("only has module edges between existing nodes", () => {
    const modules = buildModuleGraph(repo);
    const ids = new Set(modules.nodes.map((n) => n.id));
    expect(modules.edges.every((e) => ids.has(e.source) && ids.has(e.target))).toBe(true);
  });

  it("builds the neighborhood of one file", () => {
    const n = buildNeighborhood(repo, "src/services/payment.service.ts");
    expect(n.nodes.map((x) => x.id).sort()).toEqual([
      "src/config/env.ts",
      "src/middleware/error.middleware.ts",
      "src/models/types.ts",
      "src/repositories/order.repository.ts",
      "src/services/order.service.ts",
      "src/services/payment.service.ts",
      "tests/order.service.test.ts",
    ]);
  });
});

describe("search", () => {
  it("finds files by path fragment (file and directory names)", () => {
    const r = searchRepository(repo, "controllers/", "files");
    expect(r.map((x) => x.file)).toEqual(["src/controllers/auth.controller.ts", "src/controllers/orders.controller.ts", "src/controllers/products.controller.ts"]);
  });

  it("finds text with line number and excerpt", () => {
    const r = searchRepository(repo, "stripe.paymentIntents", "text");
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ file: "src/services/payment.service.ts", kind: "text" });
    const lines = repo.files.find((f) => f.path === r[0]?.file)?.content.split("\n") ?? [];
    expect(lines[(r[0]?.line ?? 1) - 1]).toContain("stripe.paymentIntents");
    expect(r[0]?.excerpt).toContain("stripe.paymentIntents");
  });

  it("text search is case-insensitive and spans unparsed files", () => {
    const r = searchRepository(repo, "CREATE TABLE", "text");
    expect(r.map((x) => x.file)).toEqual(["scripts/seed.sql", "scripts/seed.sql", "scripts/seed.sql"]);
  });

  it("finds symbols at their declaration line", () => {
    const r = searchRepository(repo, "placeOrder", "symbols");
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ file: "src/services/order.service.ts", title: "function placeOrder" });
    const lines = repo.files.find((f) => f.path === r[0]?.file)?.content.split("\n") ?? [];
    expect(lines[(r[0]?.line ?? 1) - 1]).toContain("placeOrder");
  });

  it("semantic mock maps concepts to relevant files", () => {
    const r = searchRepository(repo, "how are payments handled", "semantic");
    expect(r[0]?.file).toBe("src/services/payment.service.ts");
  });

  it("returns nothing for blank queries and validates result shape", () => {
    expect(searchRepository(repo, "   ", "text")).toEqual([]);
    for (const mode of ["files", "text", "symbols", "semantic"] as const) {
      for (const r of searchRepository(repo, "order", mode)) expect(() => SearchResultSchema.parse(r)).not.toThrow();
    }
  });
});

describe("schema validation", () => {
  it("rejects malformed repositories with a clear error", () => {
    expect(() => validateRepository({ id: "x" })).toThrow();
    expect(() => validateRepository({ ...repo, files: [{ ...repo.files[0], language: "klingon" }] })).toThrow();
    expect(() => validateRepository({ ...repo, analysis: { ...repo.analysis, schemaVersion: 99 } })).toThrow();
  });

  it("round-trips through JSON", () => {
    const parsed = validateRepository(JSON.parse(JSON.stringify(repo)));
    expect(parsed.files).toHaveLength(repo.files.length);
  });
});
