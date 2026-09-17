import { z } from "zod";
import { day, formatCharge, formatDispute } from "../format";
import { moneyLabel } from "@/lib/format/human";
import { defineReadTool } from "../types";
import { stripeId } from "./schemas";

export const getCharge = defineReadTool({
  name: "get_charge",
  description: "Get one charge with its refunds and dispute, including order_id and shipping_tracking metadata.",
  input: z.object({ id: stripeId("ch") }),
  run: async ({ id }, { stripe, now }) => {
    const charge = await stripe.charges.retrieve(id, { expand: ["refunds"] });
    const disputes = charge.disputed ? (await stripe.disputes.list({ charge: id, limit: 5 })).data : [];
    return {
      ...formatCharge(charge),
      refunds: (charge.refunds?.data ?? []).map((r) => ({
        id: r.id,
        amount: moneyLabel(r.amount, r.currency),
        status: r.status,
        reason: r.reason,
        date: day(Number(r.metadata?.seed_occurred_at) || r.created),
      })),
      disputes: disputes.map((d) => formatDispute(d, { now })),
    };
  },
});
