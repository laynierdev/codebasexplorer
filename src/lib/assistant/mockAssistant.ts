import type { AnswerBlock, Repository, SourceRef } from "@/domain/types";
import { buildGraphIndex, computeImpact, findCycles, findLayerViolations } from "@/lib/graph/analysis";
import { compact, getFile, getSymbols, lineOfText, refForLines, refForSymbol } from "@/lib/repo/refs";

/**
 * MOCK assistant. It answers from the analyzed repository model with keyword routing,
 * so every cited path, symbol and line range is real. Stage 3 swaps this for the Gemini
 * provider behind the same `answer(...)` contract.
 */

export interface AssistantContext {
  selectedFile?: string;
}

export const SUGGESTED_QUESTIONS = [
  "Explain this project to me",
  "How does authentication work?",
  "Explain the request lifecycle for placing an order",
  "Where is the database accessed?",
  "Where should I implement a new endpoint?",
  "Identify potential architectural problems",
];

export function answerQuestion(repo: Repository, question: string, ctx: AssistantContext): AnswerBlock[] {
  const q = question.toLowerCase();
  const mentioned = repo.files.find((f) => q.includes(f.path.toLowerCase()));
  if (mentioned && /(affect|impact|modify|break|change)/.test(q)) return impactAnswer(repo, mentioned.path);
  if (/(this file|selected file|current file|explain this)/.test(q) && ctx.selectedFile && !/project/.test(q)) {
    return explainFile(repo, ctx.selectedFile);
  }
  if (/(problem|concern|smell|circular|cycle|weakness|improve|risk)/.test(q)) return architectureConcerns(repo);
  if (/(new endpoint|new route|implement|add a feature|where should|add an endpoint)/.test(q)) return whereToImplement(repo);
  if (/(auth|login|token|jwt|password|register)/.test(q)) return authAnswer(repo);
  if (/(order|checkout|payment|lifecycle|request)/.test(q)) return orderLifecycle(repo);
  if (/(database|sql|postgres|query|queries|\bdb\b)/.test(q)) return databaseAnswer(repo);
  if (/(project|overview|what does|about|explain)/.test(q)) return overview(repo);
  return [
    {
      kind: "uncertain",
      text: "I could not find enough evidence in the analyzed repository to answer that confidently, so I will not guess. Try naming a file, module or feature, or pick one of the suggested questions.",
    },
  ];
}

function refs(repo: Repository, pairs: [string, string][]): SourceRef[] {
  return compact(pairs.map(([file, name]) => refForSymbol(repo, file, name)));
}

function overview(repo: Repository): AnswerBlock[] {
  const layerRefs = refs(repo, [
    ["src/server.ts", "main"],
    ["src/app.ts", "createApp"],
    ["src/routes/index.ts", "registerRoutes"],
  ]);
  return [
    {
      kind: "fact",
      text: repo.name + " is an Express + TypeScript REST API (" + repo.files.length + " files analyzed). Execution starts in src/server.ts, which checks the PostgreSQL connection, builds the app and starts listening.",
      refs: layerRefs,
    },
    {
      kind: "fact",
      text: "Routes are mounted under /api/auth, /api/products and /api/orders (" + repo.endpoints.length + " endpoints detected). Each request flows routes → controllers → services → repositories.",
      refs: refs(repo, [["src/routes/index.ts", "registerRoutes"]]),
    },
    {
      kind: "inference",
      text: "External systems are PostgreSQL (data), Stripe (payments) and an SMTP server (email), based on the packages imported by the db, payment and email modules.",
      refs: refs(repo, [["src/db/client.ts", "pool"], ["src/services/payment.service.ts", "chargeCustomer"], ["src/services/email.service.ts", "sendVerificationEmail"]]),
    },
    { kind: "recommendation", text: "Start reading at src/server.ts, then follow one flow end to end in the Flows view (Place an order covers most modules)." },
  ];
}

function authAnswer(repo: Repository): AnswerBlock[] {
  return [
    {
      kind: "fact",
      text: "Login: POST /api/auth/login → login controller validates the body with Zod → loginUser looks up the user and compares the bcrypt hash → signToken returns a JWT that expires in one hour.",
      refs: refs(repo, [["src/controllers/auth.controller.ts", "login"], ["src/services/auth.service.ts", "loginUser"], ["src/services/auth.service.ts", "signToken"]]),
    },
    {
      kind: "fact",
      text: "Protected routes use requireAuth, which strips the Bearer prefix and calls verifyToken; invalid tokens get a 401.",
      refs: refs(repo, [["src/middleware/auth.middleware.ts", "requireAuth"], ["src/services/auth.service.ts", "verifyToken"]]),
    },
    {
      kind: "inference",
      text: "Roles ('customer' | 'admin') are stored in the token, but I found no code that checks the role. Authorization appears to be authentication-only.",
      refs: refs(repo, [["src/models/types.ts", "User"]]),
    },
    {
      kind: "uncertain",
      text: "I cannot see token revocation or refresh handling anywhere in the analyzed files; it may live outside this repository.",
    },
  ];
}

function orderLifecycle(repo: Repository): AnswerBlock[] {
  return [
    {
      kind: "fact",
      text: "POST /api/orders passes requireAuth, then createOrder calls placeOrder with the authenticated user id and the request items.",
      refs: refs(repo, [["src/routes/orders.routes.ts", "ordersRouter"], ["src/controllers/orders.controller.ts", "createOrder"]]),
    },
    {
      kind: "fact",
      text: "placeOrder checks stock per item (409 if insufficient), computes the total, saves the order as pending, charges Stripe through chargeCustomer, decrements stock and sends a receipt email.",
      refs: refs(repo, [["src/services/order.service.ts", "placeOrder"], ["src/services/payment.service.ts", "chargeCustomer"], ["src/repositories/product.repository.ts", "decrementStock"]]),
    },
    {
      kind: "inference",
      text: "There is no database transaction around save, charge and stock decrement. A crash between charge and decrement would leave a paid order with unchanged stock.",
      refs: refs(repo, [["src/services/order.service.ts", "placeOrder"]]),
    },
    { kind: "recommendation", text: "Consider wrapping order creation and stock updates in one transaction and making the payment step idempotent." },
  ];
}

function databaseAnswer(repo: Repository): AnswerBlock[] {
  const repoFiles = repo.files.filter((f) => f.path.startsWith("src/repositories/")).map((f) => f.path);
  return [
    {
      kind: "fact",
      text: "All SQL goes through the query helper in src/db/client.ts, backed by a pg Pool with max 10 connections.",
      refs: refs(repo, [["src/db/client.ts", "pool"], ["src/db/client.ts", "query"]]),
    },
    {
      kind: "fact",
      text: "Only the repository layer calls query: " + repoFiles.join(", ") + ". Queries are parameterized ($1, $2...).",
      refs: refs(repo, [["src/repositories/user.repository.ts", "findUserByEmail"], ["src/repositories/order.repository.ts", "saveOrder"]]),
    },
    { kind: "uncertain", text: "The schema is in scripts/seed.sql, which is indexed as text only, so I did not analyze it structurally." },
  ];
}

function whereToImplement(repo: Repository): AnswerBlock[] {
  return [
    {
      kind: "fact",
      text: "Existing features follow the same pattern: a router in src/routes, a handler in src/controllers, business rules in src/services and SQL in src/repositories.",
      refs: refs(repo, [["src/routes/products.routes.ts", "productsRouter"], ["src/controllers/products.controller.ts", "listProducts"], ["src/services/product.service.ts", "listCatalog"], ["src/repositories/product.repository.ts", "getAllProducts"]]),
    },
    { kind: "recommendation", text: "Add the route in the matching *.routes.ts, create the controller and service functions, and register a new router in src/routes/index.ts if it is a new resource. Use requireAuth for protected routes." },
    { kind: "recommendation", text: "Add a unit test in tests/ next to the existing service tests." },
  ];
}

function architectureConcerns(repo: Repository): AnswerBlock[] {
  const cycles = findCycles(repo);
  const violations = findLayerViolations(repo).filter((v) => v.message.startsWith("Service imports"));
  const blocks: AnswerBlock[] = [];
  for (const cycle of cycles) {
    blocks.push({
      kind: "fact",
      text: "Circular dependency detected: " + cycle.join(" ⇄ ") + ".",
      refs: compact(cycle.map((file) => getSymbols(repo, file)[0]).map((s) => (s ? refForSymbol(repo, s.file, s.name) : undefined))),
    });
  }
  if (violations.length) {
    blocks.push({
      kind: "fact",
      text: violations.length + " service files import HttpError from the HTTP middleware layer, coupling business logic to Express-specific code.",
      refs: refs(repo, [["src/middleware/error.middleware.ts", "HttpError"]]),
    });
  }
  blocks.push({
    kind: "inference",
    text: "Order placement is not transactional (save, charge, stock update are separate queries).",
    refs: refs(repo, [["src/services/order.service.ts", "placeOrder"]]),
  });
  blocks.push({ kind: "recommendation", text: "Move HttpError to a neutral errors module, and extract shared token helpers to break the auth ⇄ email cycle." });
  blocks.push({ kind: "uncertain", text: "These findings come from static imports only; runtime wiring or code outside this repository is not visible to me." });
  return blocks;
}

function impactAnswer(repo: Repository, path: string): AnswerBlock[] {
  const impact = computeImpact(repo, path);
  const blocks: AnswerBlock[] = [
    {
      kind: "fact",
      text:
        "Directly imported by " +
        (impact.directDependents.length ? impact.directDependents.join(", ") : "no other file") +
        "; " +
        impact.transitiveDependents.length +
        " more file(s) depend on it indirectly.",
    },
  ];
  if (impact.affectedRoutes.length) {
    blocks.push({
      kind: "fact",
      text: "Reaches endpoints: " + impact.affectedRoutes.map((e) => e.method + " " + e.path).join(", ") + ".",
      refs: compact(impact.affectedRoutes.map((e) => refForLines(repo, e.file, e.line, e.line))),
    });
  }
  blocks.push({
    kind: "fact",
    text: impact.affectedTests.length ? "Tests that import it, directly or not: " + impact.affectedTests.join(", ") + "." : "No test file imports it, even transitively.",
  });
  blocks.push({ kind: "inference", text: "API contracts of the endpoints above may change if you alter this file's exported behavior." });
  blocks.push({ kind: "uncertain", text: "Dynamic usage, runtime wiring and consumers outside this repository are invisible to static analysis, so this list may be incomplete." });
  return blocks;
}

function explainFile(repo: Repository, path: string): AnswerBlock[] {
  const file = getFile(repo, path);
  if (!file) return [{ kind: "uncertain", text: "That file is not part of the analyzed repository." }];
  const index = buildGraphIndex(repo);
  const symbols = getSymbols(repo, path);
  const outgoing = index.outgoing.get(path) ?? [];
  const incoming = index.incoming.get(path) ?? [];
  const blocks: AnswerBlock[] = [{ kind: "fact", text: path + ": " + file.purpose }];
  if (symbols.length) {
    blocks.push({
      kind: "fact",
      text: "Defines " + symbols.map((s) => s.kind + " " + s.name).join(", ") + ".",
      refs: compact(symbols.slice(0, 4).map((s) => refForSymbol(repo, path, s.name))),
    });
  }
  blocks.push({
    kind: "fact",
    text: "Imports " + (outgoing.length ? outgoing.join(", ") : "no other project files") + "; imported by " + (incoming.length ? incoming.join(", ") : "no other project files") + ".",
  });
  if (!file.parsed) {
    blocks.push({ kind: "uncertain", text: "This file type is indexed as text only, so symbols and dependencies are not extracted." });
  }
  const line = lineOfText(repo, path, "TODO");
  if (line) blocks.push({ kind: "fact", text: "Contains a TODO.", refs: [{ file: path, startLine: line, endLine: line }] });
  return blocks;
}
