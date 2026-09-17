import type Stripe from "stripe";
import { effectiveTime } from "@/lib/tools/format";
import { collectByDate, isExperimentLeftover } from "@/lib/tools/types";
import { monthlyAmount, type AnalyticsDataShape, type ChargeRecord, type SubscriptionRecord } from "./metrics";

export type AnalyticsData = AnalyticsDataShape;

// Reads every subscription and 90 days of charges. Dates come from seeded metadata in demo mode (ADR 0001):
// seed_occurred_at for the start and seed_canceled_at for cancellations.
export async function loadAnalyticsData(stripe: Stripe, now: number): Promise<AnalyticsData> {
  const products = new Map<string, string>();
  const subscriptions: SubscriptionRecord[] = [];
  const [, , charges] = await Promise.all([
    (async () => {
      for await (const product of stripe.products.list({ limit: 100 })) products.set(product.id, product.name);
    })(),
    (async () => {
      for await (const sub of stripe.subscriptions.list({ status: "all", limit: 100 })) {
        if (isExperimentLeftover(sub)) continue;
        // Canceled within an hour of creation: it never billed a period, so it has no MRR or churn to count. This also
        // drops the 3 experiment subscriptions Stripe would not let us tag (README, Documented leftovers).
        // Seeded subscriptions are exempt: the seed cancels them within seconds and dates them by metadata instead.
        const seeded = Boolean(sub.metadata?.seed_occurred_at);
        if (!seeded && sub.status === "canceled" && (sub.ended_at ?? sub.canceled_at ?? Infinity) - sub.created < 3_600) continue;
        const item = sub.items.data[0];
        const price = item?.price;
        const seededCancel = Number(sub.metadata?.seed_canceled_at);
        subscriptions.push({
          id: sub.id,
          customerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
          status: sub.status,
          startedAt: effectiveTime(sub),
          canceledAt: sub.status === "canceled" ? (Number.isFinite(seededCancel) && seededCancel > 0 ? seededCancel : (sub.canceled_at ?? sub.ended_at ?? null)) : null,
          monthlyAmount: sub.items.data.reduce(
            (sum, i) => sum + monthlyAmount(i.price.unit_amount ?? 0, i.quantity ?? 1, i.price.recurring?.interval ?? "month", i.price.recurring?.interval_count ?? 1),
            0,
          ),
          currency: price?.currency ?? "usd",
          product: typeof price?.product === "string" ? price.product : (price?.product?.id ?? ""),
        });
      }
    })(),
    collectByDate(stripe.charges.list({ limit: 100 }), { now, days: 90 }),
  ]);
  for (const sub of subscriptions) sub.product = products.get(sub.product) ?? sub.product;
  return {
    subscriptions,
    charges: charges.map((c) => ({
      id: c.id,
      time: effectiveTime(c),
      status: (c.status === "succeeded" || c.status === "failed" ? c.status : "pending") as ChargeRecord["status"],
      amount: c.amount,
      currency: c.currency,
      brand: c.payment_method_details?.card?.brand ?? null,
      country: c.payment_method_details?.card?.country ?? null,
    })),
  };
}
