import { z } from "zod";
import { dateLabel } from "@/lib/format/human";
import { stripeId } from "../read/schemas";
import { subscriptionTarget } from "./subscription-target";
import { defineWriteTool, ProposalRejected } from "./types";

export const cancelSubscription = defineWriteTool({
  name: "cancel_subscription",
  description:
    "Propose canceling a subscription, by default at the end of the current period. Nothing changes until the merchant confirms.",
  permission: "subscriptions",
  input: z.object({ subscription_id: stripeId("sub"), at_period_end: z.boolean().default(true) }),
  describe: async ({ subscription_id, at_period_end }, { stripe, now }) => {
    const target = await subscriptionTarget(stripe, subscription_id);
    if (at_period_end && target.subscription.cancel_at_period_end) throw new ProposalRejected("This subscription is already set to cancel.");
    const periodEnd = target.subscription.items.data[0]?.current_period_end;
    return {
      summary: at_period_end
        ? `Cancel ${target.who}'s ${target.plan} at the end of the period${periodEnd ? `, ${dateLabel(periodEnd, now)}` : ""}`
        : `Cancel ${target.who}'s ${target.plan} now`,
      details: [`Status now: ${target.subscription.status.replace(/_/g, " ")}`, at_period_end ? "No further invoices after the period ends" : "Ends immediately, with no proration refund"],
      targetIds: target.ids,
      confirmLabel: `Confirm cancellation for ${target.who}`,
    };
  },
  execute: async ({ subscription_id, at_period_end }, { stripe, idempotencyKey }) => {
    const subscription = at_period_end
      ? await stripe.subscriptions.update(subscription_id, { cancel_at_period_end: true }, { idempotencyKey })
      : await stripe.subscriptions.cancel(subscription_id, {}, { idempotencyKey });
    return { id: subscription.id, status: subscription.cancel_at_period_end ? "cancels at period end" : subscription.status };
  },
});
