import Stripe from "stripe";
import { assertTestKey } from "./keys";

export function createStripeClient(key: string | undefined, name: string): Stripe {
  return new Stripe(assertTestKey(key, name), {
    appInfo: { name: "stripe-ops-agent" },
    maxNetworkRetries: 3,
  });
}
