import { z } from "zod";
import { formatCharge, formatDispute } from "../format";
import { defineReadTool } from "../types";
import { stripeId } from "./schemas";

export const getDispute = defineReadTool({
  name: "get_dispute",
  description: "Get one dispute with its evidence fields, deadline, and the disputed charge (including order and shipping metadata).",
  input: z.object({ id: stripeId("du") }),
  run: async ({ id }, { stripe, now }) => {
    const dispute = await stripe.disputes.retrieve(id, { expand: ["charge.customer"] });
    const charge = typeof dispute.charge === "string" ? null : dispute.charge;
    return { ...formatDispute(dispute, { now, withEvidence: true }), charge_details: charge ? formatCharge(charge) : undefined };
  },
});
