"use server";

import { revalidatePath } from "next/cache";
import { proposeWrite } from "@/lib/actions/propose";
import { saveProposal } from "@/lib/actions/store";
import { draftEvidence } from "@/lib/agents/disputes/draft";
import { evidenceFacts } from "@/lib/agents/disputes/evidence";
import { createAuditWriter } from "@/lib/audit/log";
import { getDb } from "@/lib/db";
import { latestDraft, saveDraft } from "@/lib/db/drafts";
import { agentModel, finishModel } from "@/lib/llm/provider";
import { getRequestContext } from "@/lib/stripe/request-context";
import { WRITE_TOOLS } from "@/lib/tools/write";
import { EVIDENCE_FIELDS } from "@/lib/tools/write/submit-dispute-evidence";

export type DisputeFormState = { ok: boolean; message: string } | null;

const DISPUTE_ID = /^du_[A-Za-z0-9]{6,}$/;
// Demo visitors share free model quotas, so a demo dispute is redrafted at most once an hour.
const DEMO_REDRAFT_MS = 60 * 60 * 1000;

export async function draftEvidenceAction(_: DisputeFormState, formData: FormData): Promise<DisputeFormState> {
  const disputeId = String(formData.get("dispute") ?? "");
  if (!DISPUTE_ID.test(disputeId)) return { ok: false, message: "Unknown dispute." };
  const { account, accountId, now } = await getRequestContext();
  const db = getDb();
  if (account.mode === "demo") {
    const recent = await latestDraft(db, { accountId, kind: "dispute_evidence", targetId: disputeId });
    if (recent && Date.now() - recent.createdAt.getTime() < DEMO_REDRAFT_MS) {
      return { ok: true, message: "Showing the latest draft. The demo redrafts each dispute at most once an hour." };
    }
  }
  const audit = createAuditWriter(accountId);
  try {
    const dispute = await account.stripe.disputes.retrieve(disputeId, { expand: ["charge.customer"] });
    const charge = typeof dispute.charge === "string" ? null : dispute.charge;
    const customerId = typeof charge?.customer === "string" ? charge.customer : charge?.customer?.id;
    const history = customerId ? (await account.stripe.charges.list({ customer: customerId, limit: 100 })).data : [];
    const facts = evidenceFacts(dispute, now, history);
    const draft = await draftEvidence(facts, [finishModel, agentModel]);
    await saveDraft(db, {
      accountId,
      kind: "dispute_evidence",
      targetId: disputeId,
      content: { fields: draft.fields, facts },
      provider: draft.served?.provider,
      modelId: draft.served?.modelId,
    });
    await audit({ agent: "disputes", tool: "draft_evidence", params: { dispute_id: disputeId }, stripeIds: [disputeId, ...(charge ? [charge.id] : [])], result: { drafted: Object.keys(draft.fields), model: draft.served?.modelId } });
    revalidatePath("/disputes");
    return { ok: true, message: "Drafted. Replace every [fill in] placeholder, then propose the submission." };
  } catch (error) {
    await audit({ agent: "disputes", tool: "draft_evidence", params: { dispute_id: disputeId }, stripeIds: [disputeId], result: { error: "draft_failed" } });
    return { ok: false, message: error instanceof Error && error.message.startsWith("Drafting failed") ? "The AI providers are busy. Try again in a minute." : "Could not load this dispute." };
  }
}

export async function proposeEvidenceAction(_: DisputeFormState, formData: FormData): Promise<DisputeFormState> {
  const disputeId = String(formData.get("dispute") ?? "");
  const evidence = Object.fromEntries(
    EVIDENCE_FIELDS.map((field) => [field, String(formData.get(field) ?? "").trim()]).filter(([, value]) => value),
  );
  const { account, accountId, now } = await getRequestContext();
  const db = getDb();
  const output = await proposeWrite(
    WRITE_TOOLS.submit_dispute_evidence,
    { dispute_id: disputeId, evidence },
    {
      stripe: account.stripe,
      now,
      agent: "disputes page",
      accountId,
      mode: account.mode,
      connectionId: account.connection?.id ?? null,
      permissions: account.connection?.permissions ?? null,
      saveProposal: (proposal) => saveProposal(db, proposal),
      audit: createAuditWriter(accountId),
    },
  );
  revalidatePath("/disputes");
  revalidatePath("/actions");
  if (output.status === "proposed") return { ok: true, message: output.demo ? "Proposed. The demo account is read-only, so it cannot be confirmed." : "Proposed. Confirm below to submit." };
  return { ok: false, message: output.message };
}
