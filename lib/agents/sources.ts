import { stripeIdsIn } from "@/lib/tools/format";

export type Sources = {
  // IDs the answer relied on that a tool returned in this run.
  cited: string[];
  // IDs the answer claims that no tool returned. Should always be empty; evals check it.
  unverified: string[];
  // Tools called, so an answer with no objects still shows what it looked at.
  tools: string[];
};

// Built from what the tools returned, not from what the model says. The answer body should contain no
// IDs, so citations come from cards shown and the IDs declared in finish_answer. IDs that still appear in
// the body are checked too.
export function buildSources(input: {
  answer: string;
  toolIds: ReadonlySet<string>;
  toolsCalled: readonly string[];
  cardIds?: readonly string[];
  declaredIds?: readonly string[];
}): Sources {
  const claimed = [...new Set([...(input.cardIds ?? []), ...(input.declaredIds ?? []), ...stripeIdsIn(input.answer)])];
  return {
    cited: claimed.filter((id) => input.toolIds.has(id)),
    unverified: claimed.filter((id) => !input.toolIds.has(id)),
    tools: [...new Set(input.toolsCalled)].filter((tool) => tool !== "finish_answer"),
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
