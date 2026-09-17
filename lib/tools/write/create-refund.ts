import { z } from "zod";
import { dateLabel, moneyLabel } from "@/lib/format/human";
import { businessMetadata, effectiveTime } from "../format";
import { stripeId } from "../read/schemas";
import { defineWriteTool, ProposalRejected } from "./types";

export const createRefund = defineWriteTool({
  name: "create_refund",
  description:
    "Propose a refund of a charge. Nothing is refunded until the merchant confirms. Omit amount_cents for a full refund of what is left.",
  permission: "refunds",
  input: z.object({
    charge_id: stripeId("ch"),
    amount_cents: z.number().int().min(1).optional(),
    reason: z.enum(["requested_by_customer", "duplicate", "fraudulent"]).default("requested_by_customer"),
  }),
  describe: async ({ charge_id, amount_cents }, { stripe, now }) => {
    const charge = await stripe.charges.retrieve(charge_id, { expand: ["customer"] });
    if (charge.status !== "succeeded") throw new ProposalRejected("Only a successful charge can be refunded.");
    const remaining = charge.amount - charge.amount_refunded;
    if (remaining <= 0) throw new ProposalRejected("This charge is already fully refunded.");
    if (charge.disputed) throw new ProposalRejected("This charge is disputed. Respond to the dispute instead of refunding it.");
    const amount = amount_cents ?? remaining;
    if (amount > remaining) throw new ProposalRejected(`At most ${moneyLabel(remaining, charge.currency)} is left to refund.`);
    const customer = charge.customer && typeof charge.customer !== "string" && !charge.customer.deleted ? charge.customer : null;
    const who = customer?.name ?? customer?.email ?? "the customer";
    const order = businessMetadata(charge.metadata)?.order_id;
    const money = moneyLabel(amount, charge.currency);
    return {
      summary: `Refund ${money} to ${who} for the ${dateLabel(effectiveTime(charge), now)} charge${order ? ` (order ${order})` : ""}`,
      details: [
        `Charged ${moneyLabel(charge.amount, charge.currency)}${charge.amount_refunded ? `, ${moneyLabel(charge.amount_refunded, charge.currency)} already refunded` : ""}`,
        amount < remaining ? "Partial refund" : "Full refund",
      ],
      targetIds: [charge.id, ...(customer ? [customer.id] : [])],
      confirmLabel: `Confirm refund of ${money}`,
    };
  },
  execute: async ({ charge_id, amount_cents, reason }, { stripe, idempotencyKey }) => {
    const refund = await stripe.refunds.create({ charge: charge_id, amount: amount_cents, reason }, { idempotencyKey });
    return { id: refund.id, status: refund.status ?? "pending" };
  },
});
