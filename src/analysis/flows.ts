import type { ApiEndpoint, ExecutionFlow, FlowStep, SourceFile, SourceSymbol } from "@/domain/types";
import type { BindingIndex } from "./bindings";
import { LAYER_LABEL } from "./layers";

const MAX_DEPTH = 6;
const MAX_STEPS = 14;
const MAX_FLOWS = 12;

/**
 * Detects execution flows deterministically: for each endpoint whose handler could be resolved,
 * follows static call edges (call names resolved through imports) from the handler.
 * Every step is backed by an import and a call expression in the source, so steps are "verified"
 * in the static sense; the runtime order of branches is not modelled.
 */
export function detectFlows(endpoints: ApiEndpoint[], files: SourceFile[], symbols: SourceSymbol[], bindings: BindingIndex): ExecutionFlow[] {
  const bySymbol = new Map<string, SourceSymbol>();
  for (const s of symbols) bySymbol.set(`${s.file}::${s.name}`, s);
  const layerOf = new Map(files.map((f) => [f.path, f.layer]));
  const hasSymbol = (file: string, name: string) => bySymbol.has(`${file}::${name}`);

  const flows: ExecutionFlow[] = [];
  for (const endpoint of endpoints) {
    if (!endpoint.handlerFile || !endpoint.handlerSymbol) continue;
    const handler = bySymbol.get(`${endpoint.handlerFile}::${endpoint.handlerSymbol}`);
    if (!handler) continue;

    const steps: FlowStep[] = [
      {
        title: `Route ${endpoint.method} ${endpoint.path}`,
        description: `Declared in ${endpoint.file} at line ${endpoint.line}.`,
        file: endpoint.file,
        symbol: endpoint.handler ?? endpoint.handlerSymbol,
        startLine: endpoint.line,
        endLine: endpoint.line,
        evidence: "verified",
      },
      stepFor(handler, `Handler for the route.`, layerOf),
    ];

    const visited = new Set<string>([`${handler.file}::${handler.name}`]);
    const walk = (from: SourceSymbol, depth: number) => {
      if (depth >= MAX_DEPTH) return;
      for (const call of from.calls) {
        if (steps.length >= MAX_STEPS) return;
        const target = bindings.resolveName(from.file, call, hasSymbol);
        if (!target) continue;
        const key = `${target.file}::${target.symbol}`;
        if (visited.has(key)) continue;
        const symbol = bySymbol.get(key);
        if (!symbol) continue;
        visited.add(key);
        steps.push(stepFor(symbol, `Called from ${from.name} (${from.file}).`, layerOf));
        walk(symbol, depth + 1);
      }
    };
    walk(handler, 0);

    flows.push({
      id: slug(`${endpoint.method}-${endpoint.path}`),
      title: `${endpoint.method} ${endpoint.path}`,
      trigger: `${endpoint.method} ${endpoint.path}`,
      summary: `Static call chain from ${handler.name} through ${steps.length - 2} project function(s). Derived from imports and call expressions; branch order at runtime is not modelled.`,
      steps,
    });
  }
  return flows.sort((a, b) => b.steps.length - a.steps.length).slice(0, MAX_FLOWS);
}

function stepFor(symbol: SourceSymbol, description: string, layerOf: Map<string, string>): FlowStep {
  const layer = layerOf.get(symbol.file) as keyof typeof LAYER_LABEL | undefined;
  return {
    title: symbol.name,
    description: `${description}${layer ? ` Layer: ${LAYER_LABEL[layer]}.` : ""}`,
    file: symbol.file,
    symbol: symbol.name,
    startLine: symbol.startLine,
    endLine: symbol.endLine,
    evidence: "verified",
  };
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
