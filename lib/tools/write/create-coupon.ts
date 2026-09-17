import { z } from "zod";
import { moneyLabel } from "@/lib/format/human";
import { defineWriteTool } from "./types";

export const createCoupon = defineWriteTool({
  name: "create_coupon",
  description: "Propose a new coupon, as a percent or a fixed amount off. Nothing is created until the merchant confirms.",
  permission: "coupons",
  input: z
    .object({
      name: z.string().min(1).max(40),
      percent_off: z.number().min(1).max(100).optional(),
      amount_off_cents: z.number().int().min(1).optional(),
      currency: z.string().length(3).default("usd"),
      duration: z.enum(["once", "repeating", "forever"]).default("once"),
      duration_in_months: z.number().int().min(1).max(36).optional(),
    })
    .refine((c) => (c.percent_off === undefined) !== (c.amount_off_cents === undefined), "set exactly one of percent_off or amount_off_cents")
    .refine((c) => c.duration !== "repeating" || c.duration_in_months !== undefined, "repeating coupons need duration_in_months"),
  describe: async (input) => {
    const off = input.percent_off !== undefined ? `${input.percent_off}% off` : `${moneyLabel(input.amount_off_cents, input.currency)} off`;
    const length =
      input.duration === "once" ? "the next invoice" : input.duration === "forever" ? "every invoice" : `${input.duration_in_months} months`;
    return {
      summary: `Create coupon "${input.name}": ${off} for ${length}`,
      details: ["Customers get it only when it is applied to their subscription or checkout"],
      targetIds: [],
      confirmLabel: `Confirm coupon "${input.name}"`,
    };
  },
  execute: async (input, { stripe, idempotencyKey }) => {
    const coupon = await stripe.coupons.create(
      {
        name: input.name,
        percent_off: input.percent_off,
        amount_off: input.amount_off_cents,
        currency: input.amount_off_cents !== undefined ? input.currency : undefined,
        duration: input.duration,
        duration_in_months: input.duration === "repeating" ? input.duration_in_months : undefined,
      },
      { idempotencyKey },
    );
    return { id: coupon.id, status: coupon.valid ? "valid" : "invalid" };
  },
});
