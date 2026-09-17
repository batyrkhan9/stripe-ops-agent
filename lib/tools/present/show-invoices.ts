import type Stripe from "stripe";
import { z } from "zod";
import type { CardsOutput, InvoiceCard } from "@/lib/cards/types";
import { dateLabel, moneyLabel, titleCase } from "@/lib/format/human";
import { explainDecline } from "@/lib/stripe/declines";
import { stripeId } from "../read/schemas";
import { defineReadTool } from "../types";

const RETRY_LABEL = { soon: "Retry soon", later: "Retry after a few days", no: "Retry will not work" } as const;

// The decline reason lives on the payment intent's error, or once that clears, on its latest failed charge.
export function invoiceCard(invoice: Stripe.Invoice, now: number, failedCharge?: Stripe.Charge | null): InvoiceCard {
  const customer = invoice.customer && typeof invoice.customer !== "string" && !invoice.customer.deleted ? invoice.customer : null;
  const intent = latestIntent(invoice);
  const intentError = intent?.last_payment_error;
  const code = intentError?.decline_code ?? intentError?.code ?? failedCharge?.outcome?.reason ?? failedCharge?.failure_code ?? null;
  const error = code ? { code } : null;
  const decline = explainDecline(code);
  const nextAttempt = invoice.next_payment_attempt;
  return {
    kind: "invoice",
    id: invoice.id!,
    title: customer?.name ?? customer?.email ?? invoice.customer_email ?? "Unknown customer",
    amount: moneyLabel(invoice.amount_remaining, invoice.currency),
    status: titleCase(invoice.status),
    failure: error ? decline.meaning : invoice.status === "open" ? "Unpaid" : "",
    retry: error ? `${RETRY_LABEL[decline.retry]}. ${decline.customerAction}.` : "",
    details: [
      invoice.attempt_count ? `${invoice.attempt_count} attempt${invoice.attempt_count === 1 ? "" : "s"}` : "",
      nextAttempt ? `Next retry ${dateLabel(nextAttempt, now)}` : invoice.status === "open" ? "No retry scheduled" : "",
      customer?.email ?? "",
    ].filter(Boolean),
    urgent: invoice.status === "open" && (invoice.attempt_count ?? 0) > 0,
    action: { label: "Plan recovery", href: `/recovery?invoice=${invoice.id}` },
  };
}

function latestIntent(invoice: Stripe.Invoice): Stripe.PaymentIntent | undefined {
  return (invoice.payments?.data ?? [])
    .map((p) => p.payment.payment_intent)
    .find((pi): pi is Stripe.PaymentIntent => Boolean(pi) && typeof pi !== "string");
}

export const showInvoices = defineReadTool({
  name: "show_invoices",
  description:
    "Show failed, open, or past-due invoices to the merchant as cards with customer, amount owed, decline reason in plain English, retry advice, and a button. Use this instead of writing a table or list of invoices. Pass invoice IDs, for example the latest_invoice IDs from list_subscriptions.",
  input: z.object({ invoice_ids: z.array(stripeId("in")).min(1).max(10) }),
  run: async ({ invoice_ids }, { stripe, now }): Promise<CardsOutput> => {
    const cards: InvoiceCard[] = [];
    const missing: string[] = [];
    for (const id of invoice_ids) {
      try {
        const invoice = await stripe.invoices.retrieve(id, { expand: ["customer", "payments.data.payment.payment_intent"] });
        const intent = latestIntent(invoice);
        const chargeId = typeof intent?.latest_charge === "string" ? intent.latest_charge : null;
        const charge = chargeId && !intent?.last_payment_error ? await stripe.charges.retrieve(chargeId).catch(() => null) : null;
        cards.push(invoiceCard(invoice, now, charge?.status === "failed" ? charge : null));
      } catch {
        missing.push(id);
      }
    }
    return missing.length ? { cards, missing } : { cards };
  },
});
