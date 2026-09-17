import Stripe from "stripe";

// charge.refunded and refund.* were added for the refund spike alert.
const HANDLED_PREFIXES = ["payment_intent.", "charge.dispute.", "invoice.", "refund."] as const;
const HANDLED_TYPES = ["charge.refunded"] as const;

export function isHandledEventType(type: string): boolean {
  return HANDLED_PREFIXES.some((prefix) => type.startsWith(prefix)) || (HANDLED_TYPES as readonly string[]).includes(type);
}

// Events that can move an alert rule's value: a new dispute, a charge attempt that succeeded or failed, a refund.
const ALERT_EVENT_TYPES = [
  "charge.dispute.created",
  "charge.dispute.closed",
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "charge.refunded",
  "refund.created",
] as const;

export function shouldCheckAlerts(type: string): boolean {
  return (ALERT_EVENT_TYPES as readonly string[]).includes(type);
}

export type StoreEvent = (event: Stripe.Event) => Promise<"stored" | "duplicate">;

export type WebhookResult = {
  status: number;
  body: { received: true; duplicate?: true; ignored?: string } | { error: string };
};

// Verifies the Stripe signature, then stores handled events. Alert and automation processing reads
// stored events later, so this stays fast and Stripe gets a 2xx unless storage fails.
export async function handleWebhook(
  input: { payload: string; signature: string | null; secret: string | undefined },
  store: StoreEvent,
): Promise<WebhookResult> {
  if (!input.secret) {
    return { status: 500, body: { error: "webhook secret not configured" } };
  }
  if (!input.signature) {
    return { status: 400, body: { error: "missing signature" } };
  }

  let event: Stripe.Event;
  try {
    event = Stripe.webhooks.constructEvent(input.payload, input.signature, input.secret);
  } catch {
    return { status: 400, body: { error: "invalid signature" } };
  }

  if (event.livemode) {
    return { status: 200, body: { received: true, ignored: "live mode event" } };
  }
  if (!isHandledEventType(event.type)) {
    return { status: 200, body: { received: true, ignored: "unhandled event type" } };
  }

  try {
    const outcome = await store(event);
    return { status: 200, body: outcome === "duplicate" ? { received: true, duplicate: true } : { received: true } };
  } catch {
    return { status: 500, body: { error: "storage failed" } };
  }
}
