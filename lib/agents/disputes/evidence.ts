import type Stripe from "stripe";
import { dateLabel, dueLabel, moneyLabel, titleCase } from "@/lib/format/human";
import { businessMetadata, effectiveTime } from "@/lib/tools/format";
import type { EvidenceField } from "@/lib/tools/write/submit-dispute-evidence";

export type EvidenceFacts = {
  disputeId: string;
  reason: string; // raw Stripe reason, e.g. product_not_received
  reasonLabel: string;
  amount: string;
  due: string;
  chargeDate: string;
  chargeDescription: string | null;
  orderId: string | null;
  trackingNumber: string | null;
  carrier: string | null;
  customerName: string | null;
  customerEmail: string | null;
  card: string | null; // "Visa ending 4242, US"
  checks: string[]; // "CVC check passed"
  refunded: string | null;
  customerHistory: string; // "7 earlier successful payments since Jun 20, no other disputes"
};

// UPS tracking numbers start with 1Z. Other carriers are left for the merchant to fill in.
export function carrierFromTracking(tracking: string | null | undefined): string | null {
  return tracking && /^1Z[0-9A-Z]{16}$/i.test(tracking) ? "UPS" : null;
}

const CHECK_LABELS: Record<string, string> = { cvc_check: "CVC", address_postal_code_check: "Postal code", address_line1_check: "Address" };

export function evidenceFacts(dispute: Stripe.Dispute, now: number, customerCharges: Stripe.Charge[]): EvidenceFacts {
  const charge = typeof dispute.charge === "string" ? null : dispute.charge;
  const customer = charge?.customer && typeof charge.customer !== "string" && !charge.customer.deleted ? charge.customer : null;
  const order = businessMetadata(charge?.metadata);
  const card = charge?.payment_method_details?.card;
  const checks = Object.entries(card?.checks ?? {})
    .filter(([key, value]) => CHECK_LABELS[key] && value)
    .map(([key, value]) => `${CHECK_LABELS[key]} check ${value === "pass" ? "passed" : String(value).replace(/_/g, " ")}`);
  const chargeTime = charge ? effectiveTime(charge) : null;
  const earlier = customerCharges.filter((c) => c.id !== charge?.id && c.status === "succeeded" && chargeTime !== null && effectiveTime(c) < chargeTime);
  const otherDisputes = customerCharges.filter((c) => c.id !== charge?.id && c.disputed).length;
  const first = earlier.length ? Math.min(...earlier.map(effectiveTime)) : null;
  return {
    disputeId: dispute.id,
    reason: dispute.reason,
    reasonLabel: titleCase(dispute.reason),
    amount: moneyLabel(dispute.amount, dispute.currency),
    due: dueLabel(dispute.evidence_details?.due_by, now),
    chargeDate: chargeTime ? dateLabel(chargeTime, now) : "",
    chargeDescription: charge?.description ?? null,
    orderId: order?.order_id ?? null,
    trackingNumber: order?.shipping_tracking ?? null,
    carrier: carrierFromTracking(order?.shipping_tracking),
    customerName: customer?.name ?? null,
    customerEmail: customer?.email ?? null,
    card: card ? `${titleCase(card.brand)} ending ${card.last4}${card.country ? `, ${card.country}` : ""}` : null,
    checks,
    refunded: charge?.amount_refunded ? moneyLabel(charge.amount_refunded, charge.currency) : null,
    customerHistory: `${earlier.length} earlier successful payment${earlier.length === 1 ? "" : "s"}${first ? ` since ${dateLabel(first, now)}` : ""}, ${otherDisputes ? `${otherDisputes} other disputed` : "no other disputes"}`,
  };
}

// Fields filled from Stripe data by code, never by the model.
export function prefilledEvidence(facts: EvidenceFacts): Partial<Record<EvidenceField, string>> {
  return {
    customer_name: facts.customerName ?? "",
    customer_email_address: facts.customerEmail ?? "",
    shipping_tracking_number: facts.trackingNumber ?? "",
    shipping_carrier: facts.carrier ?? (facts.trackingNumber ? "[fill in: carrier]" : ""),
    shipping_date: facts.trackingNumber ? "[fill in: ship date]" : "",
  };
}

// What banks look for, per reason. Short on purpose: the model writes from facts, not from this.
export const REASON_GUIDANCE: Record<string, string> = {
  fraudulent:
    "The cardholder says they did not make the payment. Show it was them: matching name and email, passed card checks, earlier undisputed payments, and delivery to their address.",
  product_not_received:
    "The customer says the order never arrived. Show it shipped and was delivered: carrier, tracking number, ship and delivery dates, and the delivery address.",
  duplicate: "The customer says they were charged twice. Show the charges are for different orders.",
  subscription_canceled: "The customer says they canceled. Show the subscription was active, the cancellation policy, and that they did not cancel before this charge.",
  product_unacceptable: "The customer says the product was defective or not as described. Show the description they agreed to and any replacement or refund offered.",
  credit_not_processed: "The customer says a promised refund was not given. Show the refund policy and whether a refund was issued.",
  general: "Explain what was sold, when it was delivered, and why the charge is valid.",
};
