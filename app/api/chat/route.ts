import { createUIMessageStreamResponse } from "ai";
import { createAuditWriter } from "@/lib/audit/log";
import { lastUserText, runAgentChat } from "@/lib/agents/run";
import type { AgentUIMessage } from "@/lib/agents/ui-types";
import { getDemoContext } from "@/lib/demo/context";
import { agentModel, finishModel } from "@/lib/llm/provider";
import { getActiveAccount } from "@/lib/stripe/active-account";
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

  const account = await getActiveAccount();
  const demo = account.mode === "demo" ? await getDemoContext() : null;
  const accountId = demo?.accountId ?? account.connection?.accountId ?? `connection:${account.connection?.id}`;

  const stream = runAgentChat(messages, {
    stripe: account.stripe,
    mode: account.mode,
    accountId,
    now: demo?.now ?? Math.floor(Date.now() / 1000),
    model: agentModel,
    finishModel,
    audit: createAuditWriter(accountId),
    saveRun,
  });
  return createUIMessageStreamResponse({ stream });
}
