import type Stripe from "stripe";
import { z } from "zod";
import { formatCharge } from "../format";
import { collectByDate, defineReadTool } from "../types";
import { days, limit, stripeId } from "./schemas";

// Expanding customers across every scanned charge would be heavy, so only the returned rows get names.
async function withCustomers(stripe: Stripe, charges: Stripe.Charge[]): Promise<Stripe.Charge[]> {
  const ids = [...new Set(charges.map((c) => c.customer).filter((c): c is string => typeof c === "string"))].slice(0, 20);
  const customers = new Map(
    (await Promise.all(ids.map((id) => stripe.customers.retrieve(id).catch(() => null)))).flatMap((c) => (c && !c.deleted ? [[c.id, c]] : [])),
  );
  return charges.map((c) => (typeof c.customer === "string" && customers.has(c.customer) ? { ...c, customer: customers.get(c.customer)! } : c));
}

export const listCharges = defineReadTool({
  name: "list_charges",
  description:
    "List charges, newest first, with totals across all matching charges (counts by status, disputed count, gross and refunded amounts). Use for payment volume, failures, decline reasons, and rates. Returned rows include customer name and email.",
  input: z.object({
    days,
    status: z.enum(["succeeded", "failed", "all"]).default("all"),
    customer: stripeId("cus").optional(),
    limit,
  }),
  run: async (input, { stripe, now }) => {
    const matching = await collectByDate(
      stripe.charges.list({ limit: 100, ...(input.customer ? { customer: input.customer } : {}) }),
      { now, days: input.days, where: (c) => input.status === "all" || c.status === input.status },
    );
    const succeeded = matching.filter((c) => c.status === "succeeded");
    const failed = matching.filter((c) => c.status === "failed");
    const byCurrency = (charges: typeof matching, pick: (c: (typeof matching)[number]) => number) =>
      Object.entries(
        charges.reduce<Record<string, number>>((acc, c) => ({ ...acc, [c.currency]: (acc[c.currency] ?? 0) + pick(c) }), {}),
      ).map(([currency, minor]) => ({ currency, amount: minor / 100 }));
    const declineCodes = failed.reduce<Record<string, number>>((acc, c) => {
      const code = c.outcome?.reason ?? c.failure_code ?? "unknown";
      return { ...acc, [code]: (acc[code] ?? 0) + 1 };
    }, {});
    return {
      totals: {
        matching: matching.length,
        succeeded: succeeded.length,
        failed: failed.length,
        disputed: matching.filter((c) => c.disputed).length,
        gross_succeeded: byCurrency(succeeded, (c) => c.amount),
        refunded: byCurrency(succeeded, (c) => c.amount_refunded),
        decline_codes: declineCodes,
      },
      charges: (await withCustomers(stripe, matching.slice(0, input.limit))).map(formatCharge),
    };
  },
});
