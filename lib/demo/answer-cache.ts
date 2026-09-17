import { createHash } from "node:crypto";
import type { InferUIMessageChunk } from "ai";
import { eq, ne } from "drizzle-orm";
import { checkAnswerRules, type CapturedAnswer } from "@/lib/agents/answer-rules";
import { FINISH_PROMPT } from "@/lib/agents/finish/prompt";
import { PLANNER_PROMPT } from "@/lib/agents/planner/prompt";
import { visibleAnswerText } from "@/lib/agents/present";
import { AGENT_NAMES, SPECIALISTS } from "@/lib/agents/registry";
import { sharedRules } from "@/lib/agents/rules";
import type { AgentUIMessage } from "@/lib/agents/ui-types";
import type { Db } from "@/lib/db/client";
import { demoAnswers } from "@/lib/db/schema";
import { MODEL_CHAIN } from "@/lib/llm/provider";
import { PRESENT_TOOLS } from "@/lib/tools/present";
import { READ_TOOLS } from "@/lib/tools/read";
import { matchDemoQuestion } from "./questions";

export type AgentChunk = InferUIMessageChunk<AgentUIMessage>;

// Bump when tool code or card formatting changes: only prompts and tool descriptions are hashed.
// 2: list_disputes lists every open dispute and names the customer, after a cached answer invented a name.
// 3: charge rows give plain decline reasons; next actions with IDs are rejected.
const FORMAT_VERSION = 3;

// Any change to a prompt, the shared rules, or the model chain gives a new version, so stale answers are
// never replayed. Rules are rendered at a fixed time so the date line does not change the hash.
export function promptVersion(): string {
  const parts = [
    FORMAT_VERSION,
    PLANNER_PROMPT,
    FINISH_PROMPT,
    sharedRules({ now: 0, mode: "demo" }),
    ...AGENT_NAMES.map((name) => SPECIALISTS[name].prompt),
    ...Object.values({ ...READ_TOOLS, ...PRESENT_TOOLS }).map((t) => `${t.name}: ${t.description}`),
    JSON.stringify(MODEL_CHAIN),
  ];
  return createHash("sha256").update(parts.join("\n---\n")).digest("hex").slice(0, 16);
}

// The demo anchor is part of the key: reseeding changes demo "now" and the data, so old answers stop matching.
export function cacheKey(question: string, anchor: number, version = promptVersion()): string {
  return createHash("sha256").update(`${question}\n${anchor}\n${version}`).digest("hex");
}

// Only a single-question demo chat can reuse a cached answer: with history, the same words can mean something else.
export function cacheableQuestion(messages: AgentUIMessage[], mode: "demo" | "connected"): string | null {
  if (mode !== "demo") return null;
  const users = messages.filter((m) => m.role === "user");
  if (users.length !== 1 || messages.length !== 1) return null;
  const text = users[0]!.parts.map((p) => (p.type === "text" ? p.text : "")).join("").trim();
  return matchDemoQuestion(text);
}

// The answer as the chat page renders it, rebuilt from stream chunks.
export function capturedAnswer(chunks: AgentChunk[]): CapturedAnswer {
  const answer: CapturedAnswer = { text: "", cards: [], nextAction: null, sources: null, tools: [] };
  for (const chunk of chunks) {
    if (chunk.type === "text-delta") answer.text += chunk.delta;
    else if (chunk.type === "text-end") answer.text += "\n\n";
    else if (chunk.type === "tool-input-available") answer.tools.push(chunk.toolName);
    else if (chunk.type === "data-cards") answer.cards.push(...chunk.data.cards);
    else if (chunk.type === "data-next") answer.nextAction = chunk.data;
    else if (chunk.type === "data-sources") answer.sources = chunk.data;
  }
  return { ...answer, text: visibleAnswerText(answer.text, answer.cards.length > 0) };
}

// A cached answer is replayed to every visitor, so it must have finished cleanly with an answer, a next action,
// and Sources, and pass every answer format rule the evals check. The first warm run cached an answer quoting
// "insufficient_funds" and a next action reading "Submit evidence for dispute and dispute".
export function isCacheableAnswer(chunks: AgentChunk[]): boolean {
  const types = new Set(chunks.map((c) => c.type));
  if (types.has("error") || !types.has("finish") || !types.has("text-delta")) return false;
  return checkAnswerRules(capturedAnswer(chunks)).every((rule) => rule.pass);
}

// Transient chunks (which model served a call) describe the original run, not the answer, so they are dropped.
export function chunksToStore(chunks: AgentChunk[]): AgentChunk[] {
  return chunks.filter((c) => !("transient" in c && c.transient));
}

export function replayStream(chunks: AgentChunk[], savedAt: Date): ReadableStream<AgentChunk> {
  const marker: AgentChunk = { type: "data-cached", data: { savedAt: savedAt.toISOString() } };
  const out = chunks[0]?.type === "start" ? [chunks[0], marker, ...chunks.slice(1)] : [marker, ...chunks];
  return new ReadableStream({
    start(controller) {
      out.forEach((chunk) => controller.enqueue(chunk));
      controller.close();
    },
  });
}

// Passes chunks through unchanged and, once the stream ends, stores them if the run succeeded.
// runOk is read in flush, which runs after the agent run's onEnd has reported its status.
export function recordStream(
  stream: ReadableStream<AgentChunk>,
  { runOk, save }: { runOk: () => boolean; save: (chunks: AgentChunk[]) => Promise<void> },
): ReadableStream<AgentChunk> {
  const chunks: AgentChunk[] = [];
  return stream.pipeThrough(
    new TransformStream<AgentChunk, AgentChunk>({
      transform(chunk, controller) {
        chunks.push(chunk);
        controller.enqueue(chunk);
      },
      async flush() {
        if (!runOk() || !isCacheableAnswer(chunks)) return;
        await save(chunksToStore(chunks)).catch((error: unknown) => console.error("demo answer cache save failed", error));
      },
    }),
  );
}

export async function loadCachedAnswer(db: Db, key: string): Promise<{ chunks: AgentChunk[]; savedAt: Date } | null> {
  const [row] = await db.select().from(demoAnswers).where(eq(demoAnswers.key, key)).limit(1);
  return row ? { chunks: row.chunks as AgentChunk[], savedAt: row.createdAt } : null;
}

export async function saveCachedAnswer(
  db: Db,
  entry: { key: string; question: string; anchor: number; version: string; chunks: AgentChunk[] },
): Promise<void> {
  const values = {
    key: entry.key,
    question: entry.question,
    anchorAt: new Date(entry.anchor * 1000),
    promptVersion: entry.version,
    chunks: entry.chunks,
    createdAt: new Date(),
  };
  await db.insert(demoAnswers).values(values).onConflictDoUpdate({ target: demoAnswers.key, set: values });
}

// Rows from older prompt versions can never match again, so warming removes them.
export async function deleteOtherVersions(db: Db, version: string): Promise<number> {
  const rows = await db.delete(demoAnswers).where(ne(demoAnswers.promptVersion, version)).returning({ key: demoAnswers.key });
  return rows.length;
}

export async function deleteCachedAnswer(db: Db, key: string): Promise<void> {
  await db.delete(demoAnswers).where(eq(demoAnswers.key, key));
}
