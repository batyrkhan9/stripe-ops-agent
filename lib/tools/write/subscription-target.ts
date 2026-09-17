import type Stripe from "stripe";
import { moneyLabel } from "@/lib/format/human";
import { ProposalRejected } from "./types";

// The customer and plan a subscription action names, so the merchant sees who is affected.
export async function subscriptionTarget(stripe: Stripe, id: string) {
  const subscription = await stripe.subscriptions.retrieve(id, { expand: ["customer", "items.data.price.product"] });
  if (subscription.status === "canceled" || subscription.status === "incomplete_expired") {
    throw new ProposalRejected("This subscription has already ended.");
  }
  const customer = typeof subscription.customer !== "string" && !subscription.customer.deleted ? subscription.customer : null;
  const item = subscription.items.data[0];
  const product = item?.price.product && typeof item.price.product !== "string" && !item.price.product.deleted ? item.price.product.name : "subscription";
  const price = item ? `${moneyLabel(item.price.unit_amount, item.price.currency)}/${item.price.recurring?.interval ?? "period"}` : "";
  return {
    subscription,
    who: customer?.name ?? customer?.email ?? "the customer",
    plan: price ? `${product} at ${price}` : product,
    ids: [subscription.id, ...(customer ? [customer.id] : [])],
  };
}
