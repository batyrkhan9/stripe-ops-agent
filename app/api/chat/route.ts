import { createUIMessageStreamResponse } from "ai";
import { saveProposal } from "@/lib/actions/store";
import { createAuditWriter } from "@/lib/audit/log";
import { lastUserText, runAgentChat } from "@/lib/agents/run";
import type { AgentUIMessage } from "@/lib/agents/ui-types";
import { cacheableQuestion, cacheKey, loadCachedAnswer, promptVersion, recordStream, replayStream, saveCachedAnswer } from "@/lib/demo/answer-cache";
import { getDb } from "@/lib/db";
import { agentModel, finishModel } from "@/lib/llm/provider";
import { getRequestContext } from "@/lib/stripe/request-context";
import { saveRun } from "@/lib/trace/store";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_QUESTION_CHARS = 2000;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { messages?: AgentUIMessage[] } | null;
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const question = lastUserText(messages);
  if (!question) return Response.json({ error: "missing question" }, { status: 400 });
  if (question.length > MAX_QUESTION_CHARS) return Response.json({ error: "question too long" }, { status: 400 });

  const { account, accountId, now } = await getRequestContext();
  const demo = account.mode === "demo" ? { now } : null;

  // Demo answers to the common questions are replayed from Postgres, which keeps the demo usable when the
  // free model tiers are rate limited.
  const cachedQuestion = demo ? cacheableQuestion(messages, account.mode) : null;
  const version = promptVersion();
  const key = demo && cachedQuestion ? cacheKey(cachedQuestion, demo.now, version) : null;
  if (key) {
    const hit = await loadCachedAnswer(getDb(), key).catch(() => null);
    if (hit) return createUIMessageStreamResponse({ stream: replayStream(hit.chunks, hit.savedAt) });
  }

  let runOk = false;
  const stream = runAgentChat(messages, {
    stripe: account.stripe,
    mode: account.mode,
    accountId,
    now,
    model: agentModel,
    finishModel,
    audit: createAuditWriter(accountId),
    writes: {
      accountId,
      connectionId: account.connection?.id ?? null,
      permissions: account.connection?.permissions ?? null,
      saveProposal: (proposal) => saveProposal(getDb(), proposal),
    },
    saveRun: async (run) => {
      runOk = run.status === "ok";
      await saveRun(run);
    },
  });
  if (!key || !demo || !cachedQuestion) return createUIMessageStreamResponse({ stream });
  const recorded = recordStream(stream, {
    runOk: () => runOk,
    save: (chunks) => saveCachedAnswer(getDb(), { key, question: cachedQuestion, anchor: demo.now, version, chunks }),
  });
  return createUIMessageStreamResponse({ stream: recorded });
}
