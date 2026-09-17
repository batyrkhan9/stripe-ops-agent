import type { Span } from "./recorder";

export type SpanNode = Span & { children: SpanNode[]; depth: number };

// Nests spans by parent, oldest first at each level. A span whose parent is missing is shown at the top level
// rather than dropped, so a partly saved run still shows everything it has.
export function buildSpanTree(spans: Span[]): SpanNode[] {
  const nodes = new Map<string, SpanNode>(spans.map((s) => [s.id, { ...s, children: [], depth: 0 }]));
  const roots: SpanNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const order = (list: SpanNode[], depth: number) => {
    list.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
    for (const node of list) {
      node.depth = depth;
      order(node.children, depth + 1);
    }
  };
  order(roots, 0);
  return roots;
}

export function flattenTree(roots: SpanNode[]): SpanNode[] {
  return roots.flatMap((node) => [node, ...flattenTree(node.children)]);
}

export type RunTotals = { inputTokens: number; outputTokens: number; modelCalls: number; toolCalls: number; errors: number; models: string[]; fellBack: boolean };

export function runTotals(spans: Span[]): RunTotals {
  const llm = spans.filter((s) => s.kind === "llm");
  return {
    inputTokens: llm.reduce((sum, s) => sum + (s.inputTokens ?? 0), 0),
    outputTokens: llm.reduce((sum, s) => sum + (s.outputTokens ?? 0), 0),
    modelCalls: llm.length,
    toolCalls: spans.filter((s) => s.kind === "tool").length,
    errors: spans.filter((s) => s.error).length,
    models: [...new Set(spans.map((s) => s.modelId).filter((m): m is string => Boolean(m)))],
    fellBack: llm.some((s) => (s.output as { fellBack?: boolean } | undefined)?.fellBack),
  };
}
