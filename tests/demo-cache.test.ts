import { describe, expect, it } from "vitest";
import type { AgentUIMessage } from "@/lib/agents/ui-types";
import {
  cacheableQuestion,
  cacheKey,
  chunksToStore,
  isCacheableAnswer,
  promptVersion,
  recordStream,
  replayStream,
  type AgentChunk,
} from "@/lib/demo/answer-cache";
import { DEMO_QUESTIONS, matchDemoQuestion, normalizeQuestion } from "@/lib/demo/questions";

const user = (text: string, id = "u1"): AgentUIMessage => ({ id, role: "user", parts: [{ type: "text", text }] });

const COMPLETE: AgentChunk[] = [
  { type: "start" },
  { type: "data-served", data: { provider: "groq", modelId: "openai/gpt-oss-120b", fellBack: false, failures: [] }, transient: true },
  { type: "text-start", id: "t" },
  { type: "text-delta", id: "t", delta: "You have two disputes." },
  { type: "text-end", id: "t" },
  { type: "data-next", data: { text: "Respond to both.", page: "disputes", button: { label: "Open disputes", href: "/disputes" } } },
  { type: "data-sources", data: { cited: [], unverified: [], tools: ["list_disputes"] } },
  { type: "finish" },
];

async function readAll(stream: ReadableStream<AgentChunk>): Promise<AgentChunk[]> {
  const out: AgentChunk[] = [];
  const reader = stream.getReader();
  for (let next = await reader.read(); !next.done; next = await reader.read()) out.push(next.value);
  return out;
}

const streamOf = (chunks: AgentChunk[]) =>
  new ReadableStream<AgentChunk>({
    start(controller) {
      chunks.forEach((c) => controller.enqueue(c));
      controller.close();
    },
  });

describe("demo questions", () => {
  it("has ten distinct questions", () => {
    expect(DEMO_QUESTIONS).toHaveLength(10);
    expect(new Set(DEMO_QUESTIONS.map(normalizeQuestion)).size).toBe(10);
  });

  it("matches case and punctuation changes, not rewording", () => {
    expect(matchDemoQuestion("  which disputes NEED a response ")).toBe("Which disputes need a response?");
    expect(matchDemoQuestion("Which disputes need a reply?")).toBeNull();
  });
});

describe("cacheableQuestion", () => {
  it("accepts a single demo question from the list", () => {
    expect(cacheableQuestion([user("What is our current balance")], "demo")).toBe("What is our current balance?");
  });

  it("refuses connected accounts, follow-ups, and other questions", () => {
    expect(cacheableQuestion([user("What is our current balance?")], "connected")).toBeNull();
    const followUp: AgentUIMessage[] = [
      user("Which disputes need a response?"),
      { id: "a1", role: "assistant", parts: [{ type: "text", text: "Two." }] },
      user("What is our current balance?", "u2"),
    ];
    expect(cacheableQuestion(followUp, "demo")).toBeNull();
    expect(cacheableQuestion([user("Refund Maya Patel")], "demo")).toBeNull();
  });
});

describe("cacheKey", () => {
  it("changes with the demo anchor and the prompt version", () => {
    const q = DEMO_QUESTIONS[0];
    expect(cacheKey(q, 100, "v1")).toBe(cacheKey(q, 100, "v1"));
    expect(cacheKey(q, 100, "v1")).not.toBe(cacheKey(q, 101, "v1"));
    expect(cacheKey(q, 100, "v1")).not.toBe(cacheKey(q, 100, "v2"));
  });

  it("uses a prompt version that is stable across calls", () => {
    expect(promptVersion()).toMatch(/^[0-9a-f]{16}$/);
    expect(promptVersion()).toBe(promptVersion());
  });
});

describe("isCacheableAnswer", () => {
  it("requires text, a next action, Sources, a finish, and no error", () => {
    expect(isCacheableAnswer(COMPLETE)).toBe(true);
    expect(isCacheableAnswer(COMPLETE.filter((c) => c.type !== "data-next"))).toBe(false);
    expect(isCacheableAnswer(COMPLETE.filter((c) => c.type !== "data-sources"))).toBe(false);
    expect(isCacheableAnswer(COMPLETE.filter((c) => c.type !== "finish"))).toBe(false);
    expect(isCacheableAnswer([...COMPLETE.slice(0, -1), { type: "error", errorText: "busy" }, { type: "finish" }])).toBe(false);
  });

  it("refuses answers that break a format rule", () => {
    const withCode = COMPLETE.map((c) => (c.type === "text-delta" ? { ...c, delta: "Nine failed with insufficient_funds." } : c));
    expect(isCacheableAnswer(withCode)).toBe(false);
  });
});

describe("recordStream and replayStream", () => {
  it("passes chunks through and saves a successful run without transient chunks", async () => {
    let saved: AgentChunk[] | null = null;
    const out = await readAll(recordStream(streamOf(COMPLETE), { runOk: () => true, save: async (c) => void (saved = c) }));
    expect(out).toEqual(COMPLETE);
    expect(saved).toEqual(chunksToStore(COMPLETE));
    expect(saved!.some((c) => c.type === "data-served")).toBe(false);
  });

  it("does not save when the run reported an error", async () => {
    let saves = 0;
    await readAll(recordStream(streamOf(COMPLETE), { runOk: () => false, save: async () => void saves++ }));
    expect(saves).toBe(0);
  });

  it("replays stored chunks with a saved-answer marker after start", async () => {
    const savedAt = new Date("2026-09-17T12:00:00Z");
    const out = await readAll(replayStream(chunksToStore(COMPLETE), savedAt));
    expect(out[0]).toEqual({ type: "start" });
    expect(out[1]).toEqual({ type: "data-cached", data: { savedAt: "2026-09-17T12:00:00.000Z" } });
    expect(out.at(-1)).toEqual({ type: "finish" });
  });
});
