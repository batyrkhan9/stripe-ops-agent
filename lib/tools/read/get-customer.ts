import { z } from "zod";
import { formatCustomer, formatSubscription } from "../format";
import { defineReadTool } from "../types";
import { stripeId } from "./schemas";

export const getCustomer = defineReadTool({
  name: "get_customer",
  description: "Get one customer with their subscriptions.",
  input: z.object({ id: stripeId("cus") }),
  run: async ({ id }, { stripe }) => {
    const customer = await stripe.customers.retrieve(id);
    if (customer.deleted) return { id, deleted: true };
    const subscriptions = await stripe.subscriptions.list({ customer: id, status: "all", limit: 20 });
    return { ...formatCustomer(customer), subscriptions: subscriptions.data.map(formatSubscription) };
  },
});
