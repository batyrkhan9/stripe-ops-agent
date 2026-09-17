"use server";

import { revalidatePath } from "next/cache";
import { draftRecoveryEmail } from "@/lib/agents/recovery/draft";
import { recoveryFacts } from "@/lib/agents/recovery/plan";
import { createAuditWriter } from "@/lib/audit/log";
import { loadInvoiceDetail } from "@/lib/cards/load";
import { getDb } from "@/lib/db";
import { latestDraft, saveDraft } from "@/lib/db/drafts";
import { agentModel, finishModel } from "@/lib/llm/provider";
import { getRequestContext } from "@/lib/stripe/request-context";

export type RecoveryFormState = { ok: boolean; message: string } | null;

const INVOICE_ID = /^in_[A-Za-z0-9]{6,}$/;
const DEMO_REDRAFT_MS = 60 * 60 * 1000;

// Drafts only. Nothing is sent: the merchant copies the email into their own tool.
export async function draftEmailAction(_: RecoveryFormState, formData: FormData): Promise<RecoveryFormState> {
  const invoiceId = String(formData.get("invoice") ?? "");
  if (!INVOICE_ID.test(invoiceId)) return { ok: false, message: "Unknown invoice." };
  const { account, accountId, now } = await getRequestContext();
  const db = getDb();
  if (account.mode === "demo") {
    const recent = await latestDraft(db, { accountId, kind: "recovery_plan", targetId: invoiceId });
    if (recent && Date.now() - recent.createdAt.getTime() < DEMO_REDRAFT_MS) {
      return { ok: true, message: "Showing the latest draft. The demo redrafts each invoice at most once an hour." };
    }
  }
  const audit = createAuditWriter(accountId);
  try {
    const detail = await loadInvoiceDetail(account.stripe, invoiceId, now);
    const facts = recoveryFacts(detail.invoice, detail.declineCode, detail.lastAttempt);
    const { email, served } = await draftRecoveryEmail(facts, now, [finishModel, agentModel]);
    await saveDraft(db, { accountId, kind: "recovery_plan", targetId: invoiceId, content: { email }, provider: served?.provider, modelId: served?.modelId });
    await audit({ agent: "recovery", tool: "draft_recovery_email", params: { invoice_id: invoiceId }, stripeIds: [invoiceId], result: { drafted: true, model: served?.modelId } });
    revalidatePath("/recovery");
    return { ok: true, message: "Drafted. Edit it, replace the [fill in] parts, and send it from your own email." };
  } catch (error) {
    await audit({ agent: "recovery", tool: "draft_recovery_email", params: { invoice_id: invoiceId }, stripeIds: [invoiceId], result: { error: "draft_failed" } });
    return { ok: false, message: error instanceof Error && error.message.startsWith("Drafting failed") ? "The AI providers are busy. Try again in a minute." : "Could not load this invoice." };
  }
}
