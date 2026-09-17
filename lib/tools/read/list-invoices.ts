import { z } from "zod";
import { formatInvoice } from "../format";
import { collectByDate, defineReadTool } from "../types";
import { days, limit, stripeId } from "./schemas";

export const listInvoices = defineReadTool({
  name: "list_invoices",
  description: "List invoices by status (draft, open, paid, uncollectible, void, all), newest first. Open invoices with attempts are failed or past due. Rows include customer name and email.",
  input: z.object({
    status: z.enum(["draft", "open", "paid", "uncollectible", "void", "all"]).default("all"),
    customer: stripeId("cus").optional(),
    subscription: stripeId("sub").optional(),
    days,
    limit,
  }),
  run: async (input, { stripe, now }) => {
    const invoices = await collectByDate(
      stripe.invoices.list({
        limit: 100,
        expand: ["data.customer"],
        ...(input.status !== "all" ? { status: input.status } : {}),
        ...(input.customer ? { customer: input.customer } : {}),
        ...(input.subscription ? { subscription: input.subscription } : {}),
      }),
      { now, days: input.days },
    );
    return { matching: invoices.length, invoices: invoices.slice(0, input.limit).map(formatInvoice) };
  },
});
