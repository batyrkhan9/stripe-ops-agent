import { moneyLabel } from "@/lib/format/human";
import {
  churn,
  cohortRetention,
  declineRateBy,
  grossVolume,
  mrrAt,
  mrrMovement,
  mrrSeries,
  type AnalyticsDataShape,
} from "./metrics";

const pct = (fraction: number, digits = 1) => `${(fraction * 100).toFixed(digits)}%`;
const signed = (minor: number, currency: string) => `${minor >= 0 ? "+" : ""}${moneyLabel(minor, currency)}`;

export function buildAnalyticsSummary({ subscriptions, charges }: AnalyticsDataShape, now: number) {
  const currency = subscriptions[0]?.currency ?? "usd";
  const movement = mrrMovement(subscriptions, now);
  const churn30 = churn(subscriptions, now);
  const gross = grossVolume(charges, now);
  const live = subscriptions.filter((s) => s.status === "active" || s.status === "past_due");
  return {
    currency,
    mrr: mrrAt(subscriptions, now),
    movement,
    churn: churn30,
    gross,
    activeCount: subscriptions.filter((s) => s.status === "active").length,
    pastDueCount: subscriptions.filter((s) => s.status === "past_due").length,
    liveCount: live.length,
    series: mrrSeries(subscriptions, now),
    cohorts: cohortRetention(subscriptions, now, 4),
    byBrand: declineRateBy(charges, now, "brand"),
    byCountry: declineRateBy(charges, now, "country"),
    labels: {
      mrr: moneyLabel(mrrAt(subscriptions, now), currency),
      mrrStart: moneyLabel(movement.start, currency),
      net: signed(movement.net, currency),
      newMrr: signed(movement.newMrr, currency),
      churnedMrr: moneyLabel(-movement.churnedMrr, currency),
      churnRate: pct(churn30.rate),
      revenueChurn: pct(churn30.revenueRate),
      gross: moneyLabel(gross.amount, currency),
      pct,
    },
  };
}

export type AnalyticsSummary = ReturnType<typeof buildAnalyticsSummary>;

// The metrics as plain sentences, with every number formatted exactly as the page shows it. The narrative model
// sees only this, and its numbers are checked against it.
export function summaryFacts(s: AnalyticsSummary): string {
  const brand = s.byBrand.map((r) => `${r.key}: ${r.failed} of ${r.attempts} failed, ${pct(r.rate)}`).join("; ");
  const country = s.byCountry.map((r) => `${r.key}: ${r.failed} of ${r.attempts} failed, ${pct(r.rate)}`).join("; ");
  // Month names, not "2026-06": a model read the ISO key as "no subscriptions started in June" (eval run 1).
  const monthName = (key: string) => new Date(`${key}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const cohorts = s.cohorts
    .map((c) => `started ${monthName(c.month)}, ${c.size} subscriptions, retained ${c.retained.filter((r) => r !== null).map((r) => pct(r!, 0)).join(", ")}`)
    .join("; ");
  return [
    `MRR now: ${s.labels.mrr} from ${s.liveCount} subscriptions (${s.activeCount} active, ${s.pastDueCount} past due).`,
    `MRR 30 days ago: ${s.labels.mrrStart}. Net change: ${s.labels.net}. New MRR: ${s.labels.newMrr} from ${s.movement.newIds.length} new subscriptions. Churned MRR: ${s.labels.churnedMrr} from ${s.movement.churnedIds.length} cancellations.`,
    `Subscriber churn, last 30 days: ${s.churn.canceled} of ${s.churn.activeAtStart} subscriptions, ${s.labels.churnRate}. Revenue churn: ${s.labels.revenueChurn}.`,
    `Gross volume, last 30 days: ${s.labels.gross} from ${s.gross.count} successful payments.`,
    `Decline rate by card brand, last 30 days: ${brand}.`,
    `Decline rate by card country, last 30 days: ${country}.`,
    `Cohort retention by start month, at the end of each month: ${cohorts}.`,
  ].join("\n");
}

// One narrative per account per day of "now", so the demo keeps a single narrative for its frozen date.
export function narrativeTarget(now: number): string {
  return `metrics:${new Date(now * 1000).toISOString().slice(0, 10)}`;
}
