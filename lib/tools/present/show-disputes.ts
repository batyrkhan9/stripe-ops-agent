import type Stripe from "stripe";
import { z } from "zod";
import type { CardsOutput, DisputeCard } from "@/lib/cards/types";
import { daysBetween, dueLabel, moneyLabel, titleCase } from "@/lib/format/human";
import { businessMetadata } from "../format";
import { stripeId } from "../read/schemas";
import { defineReadTool } from "../types";

const OPEN = ["warning_needs_response", "needs_response"];

export function disputeCard(dispute: Stripe.Dispute, now: number): DisputeCard {
  const charge = typeof dispute.charge === "string" ? null : dispute.charge;
  const customer = charge && charge.customer && typeof charge.customer !== "string" && !charge.customer.deleted ? charge.customer : null;
  const dueBy = dispute.evidence_details?.due_by ?? null;
  const order = businessMetadata(charge?.metadata);
  const needsResponse = OPEN.includes(dispute.status);
  return {
    kind: "dispute",
    id: dispute.id,
    title: customer?.name ?? customer?.email ?? "Unknown customer",
    amount: moneyLabel(dispute.amount, dispute.currency),
    reason: titleCase(dispute.reason),
    status: titleCase(dispute.status),
    due: needsResponse ? dueLabel(dueBy, now) : "",
    urgent: needsResponse && dueBy !== null && daysBetween(now, dueBy) <= 3,
    details: [order?.order_id && `Order ${order.order_id}`, order?.shipping_tracking && `Tracking ${order.shipping_tracking}`].filter(
      (d): d is string => Boolean(d),
    ),
    action: needsResponse
      ? { label: "Draft evidence", href: `/disputes?dispute=${dispute.id}#detail` }
      : { label: "View dispute", href: `/disputes?dispute=${dispute.id}#detail` },
  };
}

export const showDisputes = defineReadTool({
  name: "show_disputes",
  description:
    "Show disputes to the merchant as cards with customer, amount, reason, deadline, and a button. Use this instead of writing a table or list of disputes. Pass the dispute IDs from list_disputes, most urgent first.",
  input: z.object({ dispute_ids: z.array(stripeId("du")).min(1).max(10) }),
  run: async ({ dispute_ids }, { stripe, now }): Promise<CardsOutput> => {
    const cards: DisputeCard[] = [];
    const missing: string[] = [];
    for (const id of dispute_ids) {
      try {
        const dispute = await stripe.disputes.retrieve(id, { expand: ["charge.customer"] });
        cards.push(disputeCard(dispute, now));
      } catch {
        missing.push(id);
      }
    }
    return missing.length ? { cards, missing } : { cards };
  },
});
