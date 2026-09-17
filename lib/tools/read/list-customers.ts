import { z } from "zod";
import { formatCustomer } from "../format";
import { collectByDate, defineReadTool } from "../types";
import { limit } from "./schemas";

export const listCustomers = defineReadTool({
  name: "list_customers",
  description: "List customers, newest first. Filter by exact email. To find a customer by name, use search instead.",
  input: z.object({ email: z.email().optional(), limit }),
  run: async (input, { stripe, now }) => {
    const customers = await collectByDate(stripe.customers.list({ limit: 100, ...(input.email ? { email: input.email } : {}) }), { now });
    return { total: customers.length, customers: customers.slice(0, input.limit).map(formatCustomer) };
  },
});
