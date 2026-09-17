import "server-only";
import { getDb } from "@/lib/db";
import { agentRuns, traceSpans } from "@/lib/db/schema";
import type { RunDeps } from "@/lib/agents/run";

export const saveRun: RunDeps["saveRun"] = async (run) => {
  const db = getDb();
  await db.insert(agentRuns).values({
    id: run.runId,
    accountId: run.accountId,
    question: run.question.slice(0, 2000),
    plan: run.plan,
    status: run.status,
    error: run.error,
    latencyMs: run.latencyMs,
    sources: run.sources,
  });
  if (run.spans.length) {
    await db.insert(traceSpans).values(
      run.spans.map((span) => ({
        id: span.id,
        runId: run.runId,
        parentId: span.parentId,
        kind: span.kind,
        name: span.name,
        provider: span.provider,
        modelId: span.modelId,
        input: span.input ?? null,
        output: span.output ?? null,
        inputTokens: span.inputTokens,
        outputTokens: span.outputTokens,
        startedAt: span.startedAt,
        latencyMs: span.latencyMs,
        error: span.error,
      })),
    );
  }
};
