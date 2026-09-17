"use server";

import { revalidatePath } from "next/cache";
import { writeNarrative } from "@/lib/agents/analytics/narrative";
import { loadAnalyticsData } from "@/lib/analytics/load";
import { buildAnalyticsSummary, narrativeTarget, summaryFacts } from "@/lib/analytics/summary";
import { createAuditWriter } from "@/lib/audit/log";
import { getDb } from "@/lib/db";
import { latestDraft, saveDraft } from "@/lib/db/drafts";
import { agentModel, finishModel } from "@/lib/llm/provider";
import { getRequestContext } from "@/lib/stripe/request-context";

export type NarrativeState = { ok: boolean; message: string } | null;

const DEMO_REDRAFT_MS = 60 * 60 * 1000;

export async function writeNarrativeAction(): Promise<NarrativeState> {
  const { account, accountId, now } = await getRequestContext();
  const db = getDb();
  const targetId = narrativeTarget(now);
  if (account.mode === "demo") {
    const recent = await latestDraft(db, { accountId, kind: "analytics_narrative", targetId });
    if (recent && Date.now() - recent.createdAt.getTime() < DEMO_REDRAFT_MS) {
      return { ok: true, message: "Showing the latest narrative. The demo rewrites it at most once an hour." };
    }
  }
  try {
    const summary = buildAnalyticsSummary(await loadAnalyticsData(account.stripe, now), now);
    const facts = summaryFacts(summary);
    const narrative = await writeNarrative(facts, [agentModel, finishModel]);
    // Sources are the subscriptions behind the MRR movement, which is what the narrative explains.
    const sources = [...summary.movement.newIds, ...summary.movement.churnedIds].slice(0, 25);
    await saveDraft(db, {
      accountId,
      kind: "analytics_narrative",
      targetId,
      content: { text: narrative.text, unverified: narrative.unverified, sources, facts },
      provider: narrative.served?.provider,
      modelId: narrative.served?.modelId,
    });
    await createAuditWriter(accountId)({ agent: "analytics", tool: "write_narrative", params: { target: targetId }, stripeIds: sources, result: { chars: narrative.text.length, unverified: narrative.unverified } });
    revalidatePath("/analytics");
    return { ok: true, message: narrative.unverified.length ? "Written, with numbers that need checking." : "Written from the metrics on this page." };
  } catch {
    return { ok: false, message: "The AI providers are busy. Try again in a minute." };
  }
}
