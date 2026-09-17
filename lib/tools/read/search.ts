import { z } from "zod";
import { formatCharge, formatCustomer, formatInvoice, formatSubscription } from "../format";
import { defineReadTool, isExperimentLeftover } from "../types";
import { limit } from "./schemas";

export const search = defineReadTool({
  name: "search",
  description:
    "Search Stripe with its search query language. Examples: customers name~'John', email:'a@b.com'; charges metadata['order_id']:'KC-10234', amount>5000, status:'failed'; invoices status:'open'; subscriptions status:'past_due'. Results can lag new data by about a minute.",
  input: z.object({
    resource: z.enum(["customers", "charges", "invoices", "subscriptions"]),
    query: z.string().min(3).max(300),
    limit,
  }),
  run: async ({ resource, query, limit: max }, { stripe }) => {
    const options = { query, limit: max };
    switch (resource) {
      case "customers":
        return { results: (await stripe.customers.search(options)).data.filter((o) => !isExperimentLeftover(o)).map(formatCustomer) };
      case "charges":
        return { results: (await stripe.charges.search(options)).data.filter((o) => !isExperimentLeftover(o)).map(formatCharge) };
      case "invoices":
        return { results: (await stripe.invoices.search(options)).data.filter((o) => !isExperimentLeftover(o)).map(formatInvoice) };
      case "subscriptions":
        return { results: (await stripe.subscriptions.search(options)).data.filter((o) => !isExperimentLeftover(o)).map(formatSubscription) };
    }
  },
});
