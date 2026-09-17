// Facts about the seeded demo account at its anchor, computed straight from Stripe. evals/build-cases.ts turns them
// into expected values, so no expected number in cases.json is typed by hand.
import type Stripe from "stripe";
import { loadAnalyticsData } from "@/lib/analytics/load";
import { buildAnalyticsSummary } from "@/lib/analytics/summary";
import { loadFailedInvoices, loadOpenDisputes } from "@/lib/cards/load";
import { dateLabel, moneyLabel } from "@/lib/format/human";
import { explainDecline } from "@/lib/stripe/declines";
import { effectiveTime } from "@/lib/tools/format";
import { collectByDate } from "@/lib/tools/types";

const DAY = 86_400;

export async function groundTruth(stripe: Stripe, now: number) {
  const [charges, refunds, customers, subscriptions, openDisputes, failedInvoices, analytics] = await Promise.all([
    collectByDate(stripe.charges.list({ limit: 100, expand: ["data.customer"] }), { now, days: 90 }),
    collectByDate(stripe.refunds.list({ limit: 100 }), { now, days: 90 }),
    collectByDate(stripe.customers.list({ limit: 100 }), { now }),
    collectByDate(stripe.subscriptions.list({ limit: 100, status: "all", expand: ["data.customer"] }), { now }),
    loadOpenDisputes(stripe, now),
    loadFailedInvoices(stripe, now),
    loadAnalyticsData(stripe, now),
  ]);
  const within = (time: number, days: number) => time > now - days * DAY && time <= now;
  const window = (days: number) => {
    const inWindow = charges.filter((c) => within(effectiveTime(c), days));
    const ok = inWindow.filter((c) => c.status === "succeeded");
    const failed = inWindow.filter((c) => c.status === "failed");
    const reasons = new Map<string, number>();
    for (const c of failed) {
      const meaning = explainDecline(c.outcome?.reason ?? c.failure_code).meaning;
      reasons.set(meaning, (reasons.get(meaning) ?? 0) + 1);
    }
    return {
      succeeded: ok.length,
      failed: failed.length,
      attempts: ok.length + failed.length,
      gross: moneyLabel(ok.reduce((s, c) => s + c.amount, 0), "usd"),
      failedAmount: moneyLabel(failed.reduce((s, c) => s + c.amount, 0), "usd"),
      declineRate: `${((failed.length / Math.max(1, ok.length + failed.length)) * 100).toFixed(1)}%`,
      reasons: Object.fromEntries(reasons),
    };
  };
  const customerName = (c: Stripe.Charge | Stripe.Subscription) =>
    c.customer && typeof c.customer !== "string" && !c.customer.deleted ? (c.customer.name ?? "") : "";
  const refunds30 = refunds.filter((r) => within(effectiveTime(r), 30) && r.status !== "failed");
  const summary = buildAnalyticsSummary(analytics, now);

  const latestChargeByCustomer = new Map<string, Stripe.Charge>();
  for (const c of [...charges].sort((a, b) => effectiveTime(b) - effectiveTime(a))) {
    const name = customerName(c);
    if (name && c.status === "succeeded" && !c.disputed && c.amount_refunded === 0 && !latestChargeByCustomer.has(name)) latestChargeByCustomer.set(name, c);
  }
  const activeSubs = subscriptions
    .filter((s) => s.status === "active")
    .map((s) => ({ id: s.id, customer: customerName(s), amount: moneyLabel(s.items.data[0]?.price.unit_amount, "usd"), interval: s.items.data[0]?.price.recurring?.interval }));

  return {
    now,
    today: dateLabel(now),
    customers: customers.length,
    week: window(7),
    month: window(30),
    refunds30: { count: refunds30.length, amount: moneyLabel(refunds30.reduce((s, r) => s + r.amount, 0), "usd") },
    disputes: openDisputes.map(({ dispute, card }) => {
      const charge = typeof dispute.charge === "string" ? null : dispute.charge;
      return {
        id: dispute.id,
        chargeId: charge?.id ?? "",
        customer: card.title,
        amount: card.amount,
        reason: card.reason,
        due: card.due,
        dueDate: dateLabel(dispute.evidence_details?.due_by, now),
        orderId: charge?.metadata?.order_id ?? "",
        tracking: charge?.metadata?.shipping_tracking ?? "",
        item: (charge?.description ?? "").replace(/^Order KC-\d+: \d+x /, ""),
        chargeDate: charge ? dateLabel(effectiveTime(charge), now) : "",
        last4: charge?.payment_method_details?.card?.last4 ?? "",
      };
    }),
    disputedTotal: moneyLabel(openDisputes.reduce((s, d) => s + d.dispute.amount, 0), "usd"),
    pastDue: failedInvoices.map(({ invoice, card, declineCode }) => ({
      invoiceId: invoice.id!,
      customer: card.title,
      amount: card.amount,
      nextRetry: invoice.next_payment_attempt ? dateLabel(invoice.next_payment_attempt, now) : "",
      reason: explainDecline(declineCode).meaning,
      subscriptionId: typeof invoice.parent?.subscription_details?.subscription === "string" ? invoice.parent.subscription_details.subscription : "",
    })),
    pastDueTotal: moneyLabel(failedInvoices.reduce((s, i) => s + i.invoice.amount_remaining, 0), "usd"),
    activeSubscriptions: activeSubs,
    latestCharge: Object.fromEntries(
      [...latestChargeByCustomer.entries()].map(([name, c]) => [name, { id: c.id, amount: moneyLabel(c.amount, c.currency), cents: c.amount, date: dateLabel(effectiveTime(c), now), orderId: c.metadata?.order_id ?? "" }]),
    ),
    metrics: {
      mrr: summary.labels.mrr,
      mrrStart: summary.labels.mrrStart,
      net: summary.labels.net.replace(/^\+/, ""),
      newMrr: summary.labels.newMrr.replace(/^\+/, ""),
      churnedMrr: summary.labels.churnedMrr.replace(/^-/, ""),
      churnRate: summary.labels.churnRate,
      revenueChurn: summary.labels.revenueChurn,
      canceled: summary.churn.canceled,
      newSubscriptions: summary.movement.newIds.length,
      activeCount: summary.activeCount,
      pastDueCount: summary.pastDueCount,
      visaDecline: `${((summary.byBrand.find((r) => r.key === "visa")?.rate ?? 0) * 100).toFixed(1)}%`,
      usDecline: `${((summary.byCountry.find((r) => r.key === "US")?.rate ?? 0) * 100).toFixed(1)}%`,
      cohorts: summary.cohorts,
      disputeRate: `${((openDisputes.length / Math.max(1, window(30).succeeded)) * 100).toFixed(2)}%`,
    },
  };
}

export type GroundTruth = Awaited<ReturnType<typeof groundTruth>>;
