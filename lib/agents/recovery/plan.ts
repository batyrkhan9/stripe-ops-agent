import type Stripe from "stripe";
import { dateLabel, moneyLabel, titleCase } from "@/lib/format/human";
import { explainDecline, type DeclineExplanation } from "@/lib/stripe/declines";

const DAY = 86_400;

export type RetryStep = { at: number; label: string; action: string };

export type RecoveryFacts = {
  invoiceId: string;
  customerName: string | null;
  customerEmail: string | null;
  product: string;
  amount: string;
  attempts: number;
  declineCode: string | null;
  decline: DeclineExplanation;
  lastAttempt: number | null;
  stripeNextAttempt: number | null;
};

// Invoice lines read like "1 × Classic Box (at $15.00 / month)" or, after a plan change, "Remaining time on
// Classic Box after 17 Sep 2026". The product name is what a customer recognizes.
export function productName(description: string | null | undefined): string {
  if (!description) return "subscription";
  const match = description.match(/^(?:Remaining|Unused) time on (.+?) after /) ?? description.match(/^\d+ × (.+?)(?: \(at .*\))?$/);
  return (match?.[1] ?? description).trim();
}

export function recoveryFacts(invoice: Stripe.Invoice, declineCode: string | null, lastAttempt: number | null): RecoveryFacts {
  const customer = invoice.customer && typeof invoice.customer !== "string" && !invoice.customer.deleted ? invoice.customer : null;
  return {
    invoiceId: invoice.id!,
    customerName: customer?.name ?? null,
    customerEmail: customer?.email ?? invoice.customer_email ?? null,
    // The largest line is what the customer is paying for; a plan change also adds a negative credit line.
    product: productName([...(invoice.lines?.data ?? [])].sort((a, b) => b.amount - a.amount)[0]?.description),
    amount: moneyLabel(invoice.amount_remaining, invoice.currency),
    attempts: invoice.attempt_count ?? 0,
    declineCode,
    decline: explainDecline(declineCode),
    lastAttempt,
    stripeNextAttempt: invoice.next_payment_attempt ?? null,
  };
}

// A retry schedule from the decline type, following Stripe's guidance: soft declines (insufficient funds, generic)
// often clear within days, so retries are spaced out; hard declines (expired, stolen, fraud) never succeed on retry,
// so the plan asks the customer for a new card instead. Dates count from the last attempt, or from now.
// Steps keep their spacing but never fall in the past: if the first step is already overdue, it moves to today.
export function retrySchedule(facts: RecoveryFacts, now: number): RetryStep[] {
  const plan = (steps: [number, string][]): RetryStep[] => {
    const start = Math.max(facts.lastAttempt ?? now, now - steps[0]![0] * DAY);
    return steps.map(([days, action]) => {
      const at = start + days * DAY;
      return { at, label: at - now < DAY / 2 ? "Today" : dateLabel(at, now), action };
    });
  };
  const step = (days: number, action: string): [number, string] => [days, action];
  if (facts.decline.retry === "no") {
    return plan([
      step(0, `Email ${facts.customerName ?? "the customer"} to update their card. Retrying this card will not work: ${facts.decline.meaning.toLowerCase()}.`),
      step(3, "If the card is not updated, send a reminder."),
      step(7, "If still unpaid, propose pausing the subscription on the Actions page."),
    ]);
  }
  if (facts.decline.retry === "soon") {
    return plan([step(1, "Retry the payment."), step(3, "Retry again, and email the customer if it fails."), step(7, "If still unpaid, email the customer to use another card.")]);
  }
  return plan([
    step(3, "Retry the payment, ideally in the morning."),
    step(5, `Email ${facts.customerName ?? "the customer"}: ${facts.decline.customerAction.toLowerCase()}.`),
    step(7, "Retry again."),
    step(14, "Final retry. If it fails, propose pausing the subscription on the Actions page."),
  ]);
}

export function recoveryFactsText(facts: RecoveryFacts, now: number): string {
  return [
    `Customer: ${facts.customerName ?? "unknown name"}.`,
    `Unpaid: ${facts.amount} for ${facts.product}, after ${facts.attempts} failed attempt${facts.attempts === 1 ? "" : "s"}${facts.lastAttempt ? `, last on ${dateLabel(facts.lastAttempt, now)}` : ""}.`,
    `Why it failed: ${facts.decline.meaning}. What the customer can do: ${facts.decline.customerAction}.`,
    facts.declineCode ? `Decline type: ${titleCase(facts.declineCode)}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
