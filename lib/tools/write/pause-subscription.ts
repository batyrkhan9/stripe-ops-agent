import { z } from "zod";
import { stripeId } from "../read/schemas";
import { subscriptionTarget } from "./subscription-target";
import { defineWriteTool, ProposalRejected } from "./types";

const BEHAVIOR_TEXT = {
  void: "invoices during the pause are voided",
  keep_as_draft: "invoices during the pause stay as drafts",
  mark_uncollectible: "invoices during the pause are marked uncollectible",
} as const;

export const pauseSubscription = defineWriteTool({
  name: "pause_subscription",
  description: "Propose pausing payment collection on a subscription. Nothing changes until the merchant confirms.",
  permission: "subscriptions",
  input: z.object({ subscription_id: stripeId("sub"), behavior: z.enum(["void", "keep_as_draft", "mark_uncollectible"]).default("void") }),
  describe: async ({ subscription_id, behavior }, { stripe }) => {
    const target = await subscriptionTarget(stripe, subscription_id);
    if (target.subscription.pause_collection) throw new ProposalRejected("Collection on this subscription is already paused.");
    return {
      summary: `Pause ${target.who}'s ${target.plan}`,
      details: [`Status now: ${target.subscription.status.replace(/_/g, " ")}`, `While paused, ${BEHAVIOR_TEXT[behavior]}`],
      targetIds: target.ids,
      confirmLabel: `Confirm pause for ${target.who}`,
    };
  },
  execute: async ({ subscription_id, behavior }, { stripe, idempotencyKey }) => {
    const subscription = await stripe.subscriptions.update(subscription_id, { pause_collection: { behavior } }, { idempotencyKey });
    return { id: subscription.id, status: subscription.pause_collection ? "paused" : subscription.status };
  },
});
