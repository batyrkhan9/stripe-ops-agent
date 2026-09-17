import { z } from "zod";
import { formatSubscription } from "../format";
import { collectByDate, defineReadTool } from "../types";
import { limit, stripeId } from "./schemas";

export const listSubscriptions = defineReadTool({
  name: "list_subscriptions",
  description: "List subscriptions by status (active, past_due, canceled, paused, all), newest first, with counts by status. Each row includes the customer name and email and the latest invoice status and amount remaining.",
  input: z.object({
    status: z.enum(["active", "past_due", "canceled", "unpaid", "paused", "all"]).default("all"),
    customer: stripeId("cus").optional(),
    limit,
  }),
  run: async (input, { stripe, now }) => {
    const all = await collectByDate(
      stripe.subscriptions.list({
        limit: 100,
        status: "all",
        expand: ["data.customer", "data.latest_invoice"],
        ...(input.customer ? { customer: input.customer } : {}),
      }),
      { now },
    );
    const counts = all.reduce<Record<string, number>>((acc, s) => ({ ...acc, [s.status]: (acc[s.status] ?? 0) + 1 }), {});
    const matching = input.status === "all" ? all : all.filter((s) => s.status === input.status);
    return { counts_by_status: counts, matching: matching.length, subscriptions: matching.slice(0, input.limit).map(formatSubscription) };
  },
});
