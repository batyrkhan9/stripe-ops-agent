import { z } from "zod";
import { dueLabel, moneyLabel, titleCase } from "@/lib/format/human";
import { stripeId } from "../read/schemas";
import { defineWriteTool, ProposalRejected } from "./types";

// Text evidence fields. Stripe's customer_communication and refund_policy fields take uploaded file IDs, so drafted
// communication goes in uncategorized_text and the policy in refund_policy_disclosure (ADR 0003).
export const EVIDENCE_FIELDS = [
  "product_description",
  "customer_name",
  "customer_email_address",
  "shipping_carrier",
  "shipping_tracking_number",
  "shipping_date",
  "refund_policy_disclosure",
  "uncategorized_text",
] as const;
export type EvidenceField = (typeof EVIDENCE_FIELDS)[number];

// Drafts mark facts only the merchant knows as "[fill in: ...]". Submitting one would send the placeholder to the bank.
export const PLACEHOLDER = /\[fill in[^\]]*\]/i;

const evidence = z.object(Object.fromEntries(EVIDENCE_FIELDS.map((f) => [f, z.string().max(20_000).optional()])) as Record<EvidenceField, z.ZodOptional<z.ZodString>>);

export const submitDisputeEvidence = defineWriteTool({
  name: "submit_dispute_evidence",
  description: "Propose submitting evidence for a dispute. Submission is final. Nothing is sent until the merchant confirms.",
  permission: "disputes",
  input: z.object({ dispute_id: stripeId("du"), evidence }),
  describe: async ({ dispute_id, evidence: fields }, { stripe, now }) => {
    const dispute = await stripe.disputes.retrieve(dispute_id, { expand: ["charge.customer"] });
    if (!/needs_response/.test(dispute.status)) throw new ProposalRejected("This dispute no longer accepts evidence.");
    const filled = EVIDENCE_FIELDS.filter((f) => fields[f]?.trim());
    if (!filled.length) throw new ProposalRejected("Add evidence before submitting.");
    const placeholders = filled.filter((f) => PLACEHOLDER.test(fields[f]!));
    if (placeholders.length) throw new ProposalRejected(`Replace the [fill in] placeholders in: ${placeholders.map(titleCase).join(", ")}.`);
    const charge = typeof dispute.charge === "string" ? null : dispute.charge;
    const customer = charge?.customer && typeof charge.customer !== "string" && !charge.customer.deleted ? charge.customer : null;
    const money = moneyLabel(dispute.amount, dispute.currency);
    return {
      summary: `Submit evidence for ${customer?.name ?? "the customer"}'s ${money} ${titleCase(dispute.reason).toLowerCase()} dispute`,
      details: [dueLabel(dispute.evidence_details?.due_by, now), `${filled.length} fields: ${filled.map(titleCase).join(", ")}`, "Submission is final; Stripe sends it to the bank"],
      targetIds: [dispute.id, ...(charge ? [charge.id] : [])],
      confirmLabel: `Confirm submission for ${money} dispute`,
    };
  },
  execute: async ({ dispute_id, evidence: fields }, { stripe, idempotencyKey }) => {
    const dispute = await stripe.disputes.update(dispute_id, { evidence: fields, submit: true }, { idempotencyKey });
    return { id: dispute.id, status: dispute.status };
  },
});
