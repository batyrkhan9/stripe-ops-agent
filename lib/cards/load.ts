import type Stripe from "stripe";
import { disputeCard } from "@/lib/tools/present/show-disputes";
import { effectiveTime } from "@/lib/tools/format";
import { invoiceCard, invoiceDeclineCode, latestIntent } from "@/lib/tools/present/show-invoices";
import { collectByDate, isExperimentLeftover } from "@/lib/tools/types";
import type { DisputeCard, InvoiceCard } from "./types";

const NEEDS_RESPONSE = ["needs_response", "warning_needs_response"];

// Disputes that still need a response, soonest deadline first.
export async function loadOpenDisputes(stripe: Stripe, now: number): Promise<{ dispute: Stripe.Dispute; card: DisputeCard }[]> {
  const disputes = await collectByDate(stripe.disputes.list({ limit: 100, expand: ["data.charge.customer"] }), {
    now,
    where: (d) => NEEDS_RESPONSE.includes(d.status),
  });
  return disputes
    .sort((a, b) => (a.evidence_details?.due_by ?? Infinity) - (b.evidence_details?.due_by ?? Infinity))
    .map((dispute) => ({ dispute, card: disputeCard(dispute, now) }));
}

// Open invoices with at least one failed payment attempt, and uncollectible ones. Payment intents are expanded per
// invoice because a list expansion that deep exceeds Stripe's four level limit.
export type FailedInvoice = { invoice: Stripe.Invoice; card: InvoiceCard; declineCode: string | null; lastAttempt: number | null };

export async function loadInvoiceDetail(stripe: Stripe, id: string, now: number): Promise<FailedInvoice> {
  const invoice = await stripe.invoices.retrieve(id, { expand: ["customer", "payments.data.payment.payment_intent"] });
  const intent = latestIntent(invoice);
  const chargeId = typeof intent?.latest_charge === "string" ? intent.latest_charge : null;
  const charge = chargeId ? await stripe.charges.retrieve(chargeId).catch(() => null) : null;
  const failed = charge?.status === "failed" ? charge : null;
  return { invoice, card: invoiceCard(invoice, now, failed), declineCode: invoiceDeclineCode(invoice, failed), lastAttempt: failed ? effectiveTime(failed) : null };
}

export async function loadFailedInvoices(stripe: Stripe, now: number, max = 20): Promise<FailedInvoice[]> {
  const candidates: Stripe.Invoice[] = [];
  for (const status of ["open", "uncollectible"] as const) {
    for await (const invoice of stripe.invoices.list({ status, limit: 100 })) {
      if (isExperimentLeftover(invoice) || (status === "open" && !(invoice.attempt_count > 0))) continue;
      candidates.push(invoice);
      if (candidates.length >= max) break;
    }
  }
  const loaded = await Promise.all(candidates.map(({ id }) => loadInvoiceDetail(stripe, id!, now)));
  return loaded.sort((a, b) => (b.invoice.amount_remaining ?? 0) - (a.invoice.amount_remaining ?? 0));
}
