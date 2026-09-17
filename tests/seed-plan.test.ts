import { describe, expect, it } from "vitest";
import { buildSeedPlan, DAY, isDecline, isDispute, pending, type SeedPlan } from "@/lib/stripe/seed/plan";

const ANCHOR = 1_789_000_000;

function successfulCharges(plan: SeedPlan): number[] {
  const oneOff = plan.payments.filter((p) => !isDecline(p.outcome)).map((p) => p.occurredAt);
  const firstInvoices = plan.subscriptions.map((s) => s.startedAt);
  return [...oneOff, ...firstInvoices];
}

function inWindow(times: number[], anchor: number, days: number): number {
  return times.filter((t) => t > anchor - days * DAY && t <= anchor).length;
}

function disputeRate30d(plan: SeedPlan): number {
  const disputes = plan.payments.filter((p) => isDispute(p.outcome)).map((p) => p.occurredAt);
  return inWindow(disputes, plan.anchor, 30) / inWindow(successfulCharges(plan), plan.anchor, 30);
}

function declineRate7d(plan: SeedPlan): number {
  const declines = [
    ...plan.payments.filter((p) => isDecline(p.outcome)).map((p) => p.occurredAt),
    ...plan.subscriptions.flatMap((s) => (s.failedAt ? [s.failedAt] : [])),
  ];
  const failed = inWindow(declines, plan.anchor, 7);
  return failed / (failed + inWindow(successfulCharges(plan), plan.anchor, 7));
}

describe("buildSeedPlan", () => {
  const plan = buildSeedPlan(ANCHOR);

  it("is deterministic for the same anchor", () => {
    expect(buildSeedPlan(ANCHOR)).toEqual(plan);
  });

  it("keeps offsets stable when the anchor changes", () => {
    const later = buildSeedPlan(ANCHOR + 5 * DAY);
    expect(later.payments.map((p) => p.occurredAt - later.anchor)).toEqual(
      plan.payments.map((p) => p.occurredAt - plan.anchor),
    );
  });

  it("matches the volumes in CLAUDE.md", () => {
    expect(plan.customers).toHaveLength(40);
    expect(plan.products).toHaveLength(5);
    expect(plan.prices).toHaveLength(8);
    const byTarget = (target: string) => plan.subscriptions.filter((s) => s.target === target).length;
    expect([byTarget("active"), byTarget("past_due"), byTarget("canceled")]).toEqual([25, 5, 3]);
    expect(successfulCharges(plan)).toHaveLength(350);
    expect(plan.payments.filter((p) => isDispute(p.outcome))).toHaveLength(2);
    expect(plan.refunds).toHaveLength(6);
  });

  it("uses unique seed keys", () => {
    const keys = [plan.products, plan.prices, plan.customers, plan.subscriptions, plan.payments, plan.refunds]
      .flat()
      .map((spec) => spec.seedKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("dates everything within the last 90 days", () => {
    const times = [
      ...plan.payments.map((p) => p.occurredAt),
      ...plan.refunds.map((r) => r.occurredAt),
      ...plan.subscriptions.flatMap((s) => [s.startedAt, s.failedAt ?? s.startedAt, s.canceledAt ?? s.startedAt]),
    ];
    expect(Math.min(...times)).toBeGreaterThan(ANCHOR - 90 * DAY);
    expect(Math.max(...times)).toBeLessThanOrEqual(ANCHOR);
  });

  it("puts most charges in the trailing 30 days", () => {
    expect(inWindow(successfulCharges(plan), ANCHOR, 30)).toBeGreaterThanOrEqual(300);
  });

  it("lands the dispute rate between the 0.5% warning and Stripe's 0.75%", () => {
    const rate = disputeRate30d(plan);
    expect(rate).toBeGreaterThan(0.005);
    expect(rate).toBeLessThan(0.0075);
  });

  it("pushes the dispute rate over 0.75% with --spike", () => {
    const spiked = buildSeedPlan(ANCHOR, { spike: true });
    expect(spiked.payments.filter((p) => isDispute(p.outcome))).toHaveLength(5);
    expect(disputeRate30d(spiked)).toBeGreaterThan(0.0075);
  });

  it("makes the 7 day decline rate exceed 15%", () => {
    expect(declineRate7d(plan)).toBeGreaterThan(0.15);
  });

  it("puts 3 refunds in the last 24 hours, each after its charge and on a distinct succeeded charge", () => {
    expect(inWindow(plan.refunds.map((r) => r.occurredAt), ANCHOR, 1)).toBe(3);
    const payments = new Map(plan.payments.map((p) => [p.seedKey, p]));
    for (const refund of plan.refunds) {
      const payment = payments.get(refund.paymentKey)!;
      expect(payment.outcome).toBe("succeeded");
      expect(refund.occurredAt).toBeGreaterThan(payment.occurredAt);
      expect(refund.amount).toBeLessThanOrEqual(payment.amount);
    }
    expect(new Set(plan.refunds.map((r) => r.paymentKey)).size).toBe(6);
  });

  it("orders subscription events after the start", () => {
    for (const s of plan.subscriptions) {
      if (s.failedAt) expect(s.failedAt).toBeGreaterThan(s.startedAt);
      if (s.canceledAt) expect(s.canceledAt).toBeGreaterThan(s.startedAt);
    }
  });
});

describe("pending", () => {
  const plan = buildSeedPlan(ANCHOR);

  it("returns everything on an empty account", () => {
    expect(pending(plan.customers, new Set())).toHaveLength(40);
  });

  it("returns nothing when every seed key already exists", () => {
    expect(pending(plan.customers, new Set(plan.customers.map((c) => c.seedKey)))).toEqual([]);
  });

  it("returns only missing specs after a partial run", () => {
    const existing = new Set(plan.customers.slice(0, 25).map((c) => c.seedKey));
    expect(pending(plan.customers, existing).map((c) => c.seedKey)).toEqual(
      plan.customers.slice(25).map((c) => c.seedKey),
    );
  });
});
