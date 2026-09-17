import { stripeIdsIn } from "@/lib/tools/format";

export type Sources = {
  // IDs the answer cites that also came back from a tool call in this run.
  cited: string[];
  // IDs the answer cites that no tool returned. Should always be empty; evals check it.
  unverified: string[];
  // Tools called, so an answer that cites no IDs still shows what it looked at.
  tools: string[];
};

// Built from what the tools actually returned, not from what the model says it used.
export function buildSources(answer: string, toolIds: ReadonlySet<string>, toolsCalled: readonly string[]): Sources {
  const mentioned = stripeIdsIn(answer);
  return {
    cited: mentioned.filter((id) => toolIds.has(id)),
    unverified: mentioned.filter((id) => !toolIds.has(id)),
    tools: [...new Set(toolsCalled)],
  };
}

export function sourcesText(sources: Sources): string {
  const lines = [
    sources.cited.length
      ? `Sources: ${sources.cited.join(", ")}`
      : `Sources: no Stripe objects cited.${sources.tools.length ? ` Looked at: ${sources.tools.join(", ")}.` : " No tools were used."}`,
  ];
  if (sources.unverified.length) lines.push(`Not found in tool results: ${sources.unverified.join(", ")}`);
  return lines.join("\n");
}
