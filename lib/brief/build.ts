import type Stripe from "stripe";
import { checkAlerts } from "@/lib/alerts/check";
import type { AlertResult } from "@/lib/alerts/rules";
import { loadAnalyticsData } from "@/lib/analytics/load";
import { buildAnalyticsSummary } from "@/lib/analytics/summary";
import { loadFailedInvoices, loadOpenDisputes } from "@/lib/cards/load";
import type { DisputeCard, InvoiceCard } from "@/lib/cards/types";
import type { Db } from "@/lib/db/client";
import { dateLabel, daysBetween } from "@/lib/format/human";

// The morning brief (spec: C048, C052, C061). Every section is built by code from Stripe data; the optional summary is
// the only model output and its numbers are checked against the facts (lib/brief/summary.ts).
export type Brief = {
  dayKey: string;
  now: number;
  dateLabel: string;
  alerts: Pick<AlertResult, "rule" | "name" | "severity" | "valueLabel" | "summary">[];
  disputes: (DisputeCard & { daysLeft: number | null })[];
  invoices: InvoiceCard[];
  mrr: { now: string; start: string; net: string; newMrr: string; churnedMrr: string; liveCount: number; pastDueCount: number };
  // Items added by automations in the last day (lib/automations), each with the rule that produced it.
  items: { ruleName: string; message: string }[];
  summary: { text: string; unverified: string[] } | null;
  sources: string[];
};

export function dayKeyFor(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// Every dispute still needing a response, soonest deadline first (overdue first of all, undated last). A brief
// lists all open deadlines: a merchant reading it should never be surprised by one next week.
export function disputeDeadlines(disputes: { dispute: Stripe.Dispute; card: DisputeCard }[], now: number): Brief["disputes"] {
  return disputes
    .map(({ dispute, card }) => {
      const dueBy = dispute.evidence_details?.due_by ?? null;
      return { ...card, daysLeft: dueBy === null ? null : daysBetween(now, dueBy) };
    })
    .sort((a, b) => (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity));
}

export function briefFacts(brief: Brief): string {
  const alerts = brief.alerts.length ? brief.alerts.map((a) => `${a.name} ${a.valueLabel} (${a.severity}): ${a.summary}`).join(" ") : "No alert rules are firing.";
  const disputes = brief.disputes.length
    ? brief.disputes.map((d) => `${d.title}, ${d.amount}, ${d.reason.toLowerCase()}, ${d.due}`).join("; ")
    : "No disputes need a response.";
  const invoices = brief.invoices.length ? brief.invoices.map((i) => `${i.title} owes ${i.amount} (${i.failure.toLowerCase() || "unpaid"})`).join("; ") : "No failed invoices.";
  return [
    `Date: ${brief.dateLabel}.`,
    `Alerts: ${alerts}`,
    `Dispute deadlines: ${disputes}`,
    `Failed invoices: ${invoices}`,
    `MRR: ${brief.mrr.now} now from ${brief.mrr.liveCount} subscriptions (${brief.mrr.pastDueCount} past due); ${brief.mrr.start} 30 days ago; net ${brief.mrr.net}; new ${brief.mrr.newMrr}; churned ${brief.mrr.churnedMrr}.`,
    brief.items.length ? `Automation notes: ${brief.items.map((i) => `${i.ruleName}: ${i.message}`).join("; ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function buildBrief({
  db,
  stripe,
  accountId,
  now,
  date,
  items,
}: {
  db: Db;
  stripe: Stripe;
  accountId: string;
  now: number;
  date: Date;
  items: Brief["items"];
}): Promise<Brief> {
  const [alerts, disputes, invoices, analytics] = await Promise.all([
    checkAlerts({ db, stripe, accountId, now, trigger: "cron" }),
    loadOpenDisputes(stripe, now),
    loadFailedInvoices(stripe, now, 10),
    loadAnalyticsData(stripe, now),
  ]);
  const s = buildAnalyticsSummary(analytics, now);
  const due = disputeDeadlines(disputes, now);
  const invoiceCards = invoices.map((i) => i.card);
  return {
    dayKey: dayKeyFor(date),
    now,
    dateLabel: dateLabel(now),
    alerts: alerts.filter((a) => a.firing).map(({ rule, name, severity, valueLabel, summary }) => ({ rule, name, severity, valueLabel, summary })),
    disputes: due,
    invoices: invoiceCards,
    mrr: {
      now: s.labels.mrr,
      start: s.labels.mrrStart,
      net: s.labels.net,
      newMrr: s.labels.newMrr,
      churnedMrr: s.labels.churnedMrr,
      liveCount: s.liveCount,
      pastDueCount: s.pastDueCount,
    },
    items,
    summary: null,
    sources: [...new Set([...due.map((d) => d.id), ...invoiceCards.map((i) => i.id), ...alerts.flatMap((a) => a.stripeIds)])].slice(0, 60),
  };
}
