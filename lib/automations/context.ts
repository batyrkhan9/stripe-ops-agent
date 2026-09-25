import type Stripe from "stripe";
import type { AlertResult } from "@/lib/alerts/rules";
import type { AnalyticsSummary } from "@/lib/analytics/summary";
import { explainDecline } from "@/lib/stripe/declines";
import { type EventTrigger, type RuleFields } from "./schema";

// What a rule can see. Targets are the Stripe IDs an action would act on; they come from the event, never from
// the model.
export type RuleContext =
  | { kind: "event"; event: EventTrigger; eventId: string; fields: RuleFields; targets: { charge?: string; subscription?: string; invoice?: string; dispute?: string; customer?: string } }
  | { kind: "schedule"; fields: RuleFields; targets: Record<string, never> };

const id = (value: unknown): string | undefined => (typeof value === "string" ? value : value && typeof value === "object" && "id" in value ? String((value as { id: unknown }).id) : undefined);

export function eventContext(event: Stripe.Event): RuleContext | null {
  const type = event.type as EventTrigger;
  const object = event.data.object as unknown as Record<string, unknown>;
  const money = (minor: unknown) => Math.round(Number(minor ?? 0)) / 100;
  const base = { kind: "event" as const, event: type, eventId: event.id };
  switch (type) {
    case "charge.dispute.created": {
      const d = object as unknown as Stripe.Dispute;
      return { ...base, fields: { amount: money(d.amount), currency: d.currency, dispute_reason: d.reason }, targets: { dispute: d.id, charge: id(d.charge) } };
    }
    case "payment_intent.payment_failed":
    case "payment_intent.succeeded": {
      const pi = object as unknown as Stripe.PaymentIntent;
      const code = pi.last_payment_error?.decline_code ?? pi.last_payment_error?.code ?? null;
      const fields: RuleFields = { amount: money(pi.amount), currency: pi.currency, customer_email: pi.receipt_email ?? "" };
      if (type === "payment_intent.payment_failed") fields.decline_reason = code ? explainDecline(code).meaning : "";
      return { ...base, fields, targets: { charge: id(pi.latest_charge), customer: id(pi.customer) } };
    }
    case "invoice.payment_failed": {
      const inv = object as unknown as Stripe.Invoice;
      return {
        ...base,
        fields: { amount: money(inv.amount_due), currency: inv.currency, attempt_count: inv.attempt_count ?? 0, customer_email: inv.customer_email ?? "" },
        targets: { invoice: inv.id, subscription: id(inv.parent?.subscription_details?.subscription), customer: id(inv.customer) },
      };
    }
    case "charge.refunded": {
      const ch = object as unknown as Stripe.Charge;
      return { ...base, fields: { amount: money(ch.amount_refunded), currency: ch.currency, customer_email: ch.receipt_email ?? ch.billing_details?.email ?? "" }, targets: { charge: ch.id, customer: id(ch.customer) } };
    }
    default:
      return null;
  }
}

export function scheduleContext(input: { alerts: AlertResult[]; summary: AnalyticsSummary; failedInvoices: number; openDisputes: number }): RuleContext {
  const alert = (rule: string) => input.alerts.find((a) => a.rule === rule);
  return {
    kind: "schedule",
    fields: {
      chargeback_rate_30d: Math.round((alert("chargeback_rate")?.value ?? 0) * 10_000) / 100,
      decline_rate_7d: Math.round((alert("decline_rate")?.value ?? 0) * 10_000) / 100,
      refunds_24h: alert("refund_spike")?.value ?? 0,
      failed_invoices: input.failedInvoices,
      open_disputes: input.openDisputes,
      mrr: input.summary.mrr / 100,
      mrr_net_30d: input.summary.movement.net / 100,
    },
    targets: {},
  };
}
