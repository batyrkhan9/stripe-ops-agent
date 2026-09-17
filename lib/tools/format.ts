import type Stripe from "stripe";
import { dateLabel, dueLabel, moneyLabel, titleCase } from "@/lib/format/human";
import { explainDecline } from "@/lib/stripe/declines";

// Compact, model-friendly views of Stripe objects. Keeps token use low on free tiers and drops
// fields the agent does not need. Amounts are converted from minor units.

export const STRIPE_ID_PATTERN = /\b(?:ch|py|cus|sub|in|du|re|pi|prod|price|cn|evt|txn)_[A-Za-z0-9]{10,}\b/g;

export function stripeIdsIn(value: unknown): string[] {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? null);
  return [...new Set(text.match(STRIPE_ID_PATTERN) ?? [])];
}

const SECRET_PATTERN = /\b(?:sk|rk|pk)_(?:test|live)_[A-Za-z0-9*]+|\bwhsec_[A-Za-z0-9]+/g;

export function redactSecrets(text: string): string {
  return text.replace(SECRET_PATTERN, "[redacted]");
}

type WithDates = { created: number; metadata?: Stripe.Metadata | null };

// Seeded demo objects carry their intended date in metadata (ADR 0001). Real accounts use created.
export function effectiveTime(object: WithDates): number {
  const seeded = Number(object.metadata?.seed_occurred_at);
  return Number.isFinite(seeded) && seeded > 0 ? seeded : object.created;
}

// Tools return labels, not raw numbers: a bare 195 was read by the model as $1.95 (evals/format-results.md).
export const day = (unix: number | null | undefined) => (unix ? dateLabel(unix, Math.floor(Date.now() / 1000)) : null);
const money = (minor: number | null | undefined, currency: string | null | undefined) => (minor == null ? null : moneyLabel(minor, currency));
const idOf = (value: string | { id: string } | null | undefined) => (value == null ? null : typeof value === "string" ? value : value.id);

// When a list call expands the customer, include name and email so the model does not need a
// get_customer call per row. Groq's free tier token budget makes those follow-up calls expensive.
type CustomerRef = string | Stripe.Customer | Stripe.DeletedCustomer | null | undefined;
function customerFields(customer: CustomerRef) {
  if (customer && typeof customer !== "string" && !customer.deleted) {
    return { customer: customer.id, customer_name: customer.name ?? undefined, customer_email: customer.email ?? undefined };
  }
  return { customer: idOf(customer ?? null) };
}

// Drops seed bookkeeping so the model only sees business metadata such as order_id.
export function businessMetadata(metadata: Stripe.Metadata | null | undefined): Record<string, string> | undefined {
  const entries = Object.entries(metadata ?? {}).filter(([key]) => !key.startsWith("seed") && !key.startsWith("permission_probe"));
  return entries.length ? Object.fromEntries(entries) : undefined;
}

export function formatCharge(charge: Stripe.Charge) {
  const card = charge.payment_method_details?.card;
  return {
    id: charge.id,
    date: day(effectiveTime(charge)),
    status: charge.status,
    amount: money(charge.amount, charge.currency),
    ...customerFields(charge.customer),
    description: charge.description,
    card: card ? { brand: card.brand, country: card.country } : undefined,
    // Plain reason only: with raw codes in rows, the model quoted "insufficient_funds" in answers.
    failure: charge.status === "failed" ? declineFields(charge.outcome?.reason ?? charge.failure_code) : undefined,
    disputed: charge.disputed || undefined,
    refunded_amount: charge.amount_refunded ? money(charge.amount_refunded, charge.currency) : undefined,
    payment_intent: idOf(charge.payment_intent),
    metadata: businessMetadata(charge.metadata),
  };
}

export function declineFields(code: string | null | undefined) {
  const explained = explainDecline(code);
  return { reason: explained.meaning, retry: explained.retry, customer_action: explained.customerAction };
}

export function formatCustomer(customer: Stripe.Customer) {
  return {
    id: customer.id,
    name: customer.name,
    email: customer.email,
    date: day(effectiveTime(customer)),
    delinquent: customer.delinquent || undefined,
    metadata: businessMetadata(customer.metadata),
  };
}

export function formatSubscription(subscription: Stripe.Subscription) {
  const canceledAt = Number(subscription.metadata?.seed_canceled_at) || subscription.canceled_at;
  return {
    id: subscription.id,
    status: subscription.status,
    ...customerFields(subscription.customer),
    started: day(effectiveTime(subscription)),
    canceled_at: day(canceledAt),
    cancel_at_period_end: subscription.cancel_at_period_end || undefined,
    paused: subscription.pause_collection ? true : undefined,
    items: subscription.items.data.map((item) => ({
      price: item.price.id,
      product: idOf(item.price.product),
      amount: money(item.price.unit_amount, item.price.currency),
      interval: item.price.recurring?.interval,
      current_period_end: day(item.current_period_end),
    })),
    latest_invoice:
      subscription.latest_invoice && typeof subscription.latest_invoice !== "string"
        ? {
            id: subscription.latest_invoice.id,
            status: subscription.latest_invoice.status,
            amount_remaining: money(subscription.latest_invoice.amount_remaining, subscription.latest_invoice.currency),
            attempt_count: subscription.latest_invoice.attempt_count,
          }
        : idOf(subscription.latest_invoice),
  };
}

export function formatInvoice(invoice: Stripe.Invoice) {
  return {
    id: invoice.id,
    status: invoice.status,
    ...customerFields(invoice.customer),
    subscription: idOf(invoice.parent?.subscription_details?.subscription),
    billing_reason: invoice.billing_reason,
    date: day(effectiveTime(invoice)),
    amount_due: money(invoice.amount_due, invoice.currency),
    amount_paid: money(invoice.amount_paid, invoice.currency),
    amount_remaining: money(invoice.amount_remaining, invoice.currency),
    attempt_count: invoice.attempt_count,
    next_payment_attempt: day(invoice.next_payment_attempt),
    due_date: day(invoice.due_date),
  };
}

export function formatDispute(dispute: Stripe.Dispute, options: { now: number; withEvidence?: boolean }) {
  const withEvidence = options.withEvidence ?? false;
  const evidence = withEvidence
    ? Object.fromEntries(Object.entries(dispute.evidence ?? {}).filter(([, value]) => value !== null && value !== ""))
    : undefined;
  return {
    id: dispute.id,
    status: dispute.status,
    reason: titleCase(dispute.reason),
    amount: money(dispute.amount, dispute.currency),
    charge: idOf(dispute.charge),
    ...(dispute.charge && typeof dispute.charge !== "string"
      ? { ...customerFields(dispute.charge.customer), order: businessMetadata(dispute.charge.metadata) }
      : {}),
    date: day(effectiveTime(dispute)),
    deadline: /needs_response/.test(dispute.status) ? dueLabel(dispute.evidence_details?.due_by, options.now) : undefined,
    evidence_submitted: (dispute.evidence_details?.submission_count ?? 0) > 0,
    evidence: evidence && Object.keys(evidence).length ? evidence : withEvidence ? {} : undefined,
  };
}

export function formatBalance(balance: Stripe.Balance) {
  const sums = (entries: Stripe.Balance.Available[]) => entries.map((b) => money(b.amount, b.currency));
  return { available: sums(balance.available), pending: sums(balance.pending) };
}
