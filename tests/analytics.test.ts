import { describe, expect, it } from "vitest";
import {
  churn,
  cohortRetention,
  DAY,
  declineRateBy,
  grossVolume,
  isLiveAt,
  monthlyAmount,
  mrrAt,
  mrrMovement,
  mrrSeries,
  type ChargeRecord,
  type SubscriptionRecord,
} from "@/lib/analytics/metrics";

// 2026-09-17 00:00 UTC
const NOW = Date.UTC(2026, 8, 17) / 1000;

const sub = (id: string, startedDaysAgo: number, monthly: number, extra: Partial<SubscriptionRecord> = {}): SubscriptionRecord => ({
  id,
  customerId: `cus_${id}`,
  status: "active",
  startedAt: NOW - startedDaysAgo * DAY,
  canceledAt: null,
  monthlyAmount: monthly,
  currency: "usd",
  product: "Classic Box",
  ...extra,
});

describe("monthlyAmount", () => {
  it("normalizes yearly, monthly, and quantity", () => {
    expect(monthlyAmount(1900, 1, "month")).toBe(1900);
    expect(monthlyAmount(19000, 1, "year")).toBe(1583);
    expect(monthlyAmount(1200, 2, "month", 3)).toBe(800);
  });
});

describe("MRR", () => {
  const subs = [
    sub("a", 80, 1900),
    sub("b", 10, 3400),
    sub("c", 60, 5900, { status: "canceled", canceledAt: NOW - 20 * DAY }),
    sub("d", 50, 3400, { status: "past_due" }),
    sub("e", 5, 9999, { status: "incomplete_expired" }),
  ];

  it("counts active and past_due subscriptions live at a time, never incomplete ones", () => {
    expect(mrrAt(subs, NOW)).toBe(1900 + 3400 + 3400);
    expect(mrrAt(subs, NOW - 30 * DAY)).toBe(1900 + 5900 + 3400);
    expect(isLiveAt(subs[4]!, NOW)).toBe(false);
  });

  it("splits 30 day movement into new and churned MRR", () => {
    expect(mrrMovement(subs, NOW)).toEqual({
      start: 11200,
      end: 8700,
      newMrr: 3400,
      churnedMrr: 5900,
      net: -2500,
      newIds: ["b"],
      churnedIds: ["c"],
    });
  });

  it("builds weekly points oldest first ending at now", () => {
    const series = mrrSeries(subs, NOW, 13);
    expect(series).toHaveLength(13);
    expect(series.at(-1)).toEqual({ at: NOW, mrr: 8700, subscriptions: 3 });
    expect(series[0]!.at).toBe(NOW - 84 * DAY);
    expect(series[0]!.mrr).toBe(0);
    expect(series[1]!.mrr).toBe(1900);
  });
});

describe("churn", () => {
  it("divides cancellations by subscriptions live at the window start", () => {
    const subs = [sub("a", 80, 1000), sub("b", 70, 3000, { status: "canceled", canceledAt: NOW - 5 * DAY }), sub("c", 10, 5000, { status: "canceled", canceledAt: NOW - 2 * DAY }), sub("d", 40, 1000)];
    // c started inside the window, so it is not in the denominator or the numerator.
    expect(churn(subs, NOW)).toEqual({ activeAtStart: 3, canceled: 1, rate: 1 / 3, revenueRate: 3000 / 5000, canceledIds: ["b"] });
  });

  it("is zero with no subscriptions", () => {
    expect(churn([], NOW)).toMatchObject({ rate: 0, revenueRate: 0 });
  });
});

describe("cohortRetention", () => {
  it("groups by start month and reports retention at each month end, null for months not reached", () => {
    const july = Date.UTC(2026, 6, 10) / 1000;
    const subs = [
      sub("a", 0, 1000, { startedAt: july }),
      sub("b", 0, 1000, { startedAt: july, status: "canceled", canceledAt: Date.UTC(2026, 7, 5) / 1000 }),
      sub("c", 0, 1000, { startedAt: Date.UTC(2026, 8, 2) / 1000 }),
    ];
    const cohorts = cohortRetention(subs, NOW, 4);
    expect(cohorts).toEqual([
      { month: "2026-07", size: 2, retained: [1, 0.5, 0.5, null] },
      { month: "2026-09", size: 1, retained: [1, null, null, null] },
    ]);
  });
});

describe("declineRateBy", () => {
  const charge = (id: string, status: ChargeRecord["status"], brand: string, country: string, daysAgo = 1): ChargeRecord => ({
    id,
    time: NOW - daysAgo * DAY,
    status,
    amount: 1000,
    currency: "usd",
    brand,
    country,
  });

  it("groups attempts by brand or country, ignoring pending and old charges", () => {
    const charges = [
      charge("1", "succeeded", "visa", "US"),
      charge("2", "failed", "visa", "US"),
      charge("3", "succeeded", "mastercard", "GB"),
      charge("4", "pending", "visa", "US"),
      charge("5", "failed", "visa", "US", 40),
    ];
    expect(declineRateBy(charges, NOW, "brand")).toEqual([
      { key: "visa", attempts: 2, failed: 1, rate: 0.5 },
      { key: "mastercard", attempts: 1, failed: 0, rate: 0 },
    ]);
    expect(declineRateBy(charges, NOW, "country").map((r) => r.key)).toEqual(["US", "GB"]);
    expect(grossVolume(charges, NOW)).toEqual({ amount: 2000, count: 2 });
  });
});

describe("narrative checks", async () => {
  const { unverifiedNumbers } = await import("@/lib/agents/analytics/narrative");
  const { buildAnalyticsSummary, summaryFacts } = await import("@/lib/analytics/summary");

  it("flags money and percentages the metrics do not contain", () => {
    const facts = "MRR now: $945.31. Net change: +$53.66. Churned MRR: -$107.00. Churn: 11.1%.";
    expect(unverifiedNumbers("MRR is $945.31, up $53.66 after cancellations took $107.00, with 11.1% churn.", facts)).toEqual([]);
    expect(unverifiedNumbers("MRR is $950.00 and churn is 12%.", facts)).toEqual(["$950.00", "12%"]);
  });

  it("writes facts with the same labels the page shows", () => {
    const summary = buildAnalyticsSummary({ subscriptions: [sub("a", 80, 1900), sub("b", 10, 3400)], charges: [] }, NOW);
    const facts = summaryFacts(summary);
    expect(facts).toContain("MRR now: $53.00 from 2 subscriptions (2 active, 0 past due).");
    expect(facts).toContain("Net change: +$34.00");
  });
});
