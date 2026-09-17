import { describe, expect, it } from "vitest";
import type { Span } from "@/lib/trace/recorder";
import { buildSpanTree, flattenTree, runTotals } from "@/lib/trace/tree";

const at = (s: number) => new Date(1_789_000_000_000 + s * 1000);
const span = (id: string, parentId: string | null, kind: Span["kind"], start: number, extra: Partial<Span> = {}): Span => ({
  id,
  parentId,
  kind,
  name: id,
  startedAt: at(start),
  latencyMs: 100,
  ...extra,
});

describe("buildSpanTree", () => {
  it("nests spans under their parents in start order, with depth", () => {
    const spans = [
      span("tool-2", "disputes", "tool", 4),
      span("planner", null, "planner", 0),
      span("disputes", "planner", "specialist", 1),
      span("tool-1", "disputes", "tool", 2),
      span("finish", "planner", "specialist", 6),
    ];
    const flat = flattenTree(buildSpanTree(spans));
    expect(flat.map((n) => `${n.depth}:${n.id}`)).toEqual(["0:planner", "1:disputes", "2:tool-1", "2:tool-2", "1:finish"]);
  });

  it("keeps spans whose parent was not saved", () => {
    expect(buildSpanTree([span("orphan", "missing", "tool", 0)]).map((n) => n.id)).toEqual(["orphan"]);
  });
});

describe("runTotals", () => {
  it("sums tokens over model calls and notes fallbacks and errors", () => {
    const totals = runTotals([
      span("planner", null, "planner", 0, { modelId: "openai/gpt-oss-120b" }),
      span("llm-1", "planner", "llm", 1, { inputTokens: 900, outputTokens: 60, modelId: "openai/gpt-oss-120b", output: { fellBack: false } }),
      span("llm-2", "planner", "llm", 2, { inputTokens: 1200, outputTokens: 80, modelId: "openai/gpt-oss-20b", output: { fellBack: true } }),
      span("tool", "planner", "tool", 3, { error: "tool returned an error" }),
    ]);
    expect(totals).toEqual({ inputTokens: 2100, outputTokens: 140, modelCalls: 2, toolCalls: 1, errors: 1, models: ["openai/gpt-oss-120b", "openai/gpt-oss-20b"], fellBack: true });
  });
});
