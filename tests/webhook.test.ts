import Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import { handleWebhook, isHandledEventType, type StoreEvent } from "@/lib/stripe/webhook";

const SECRET = "whsec_test_secret";

function event(type: string, overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    id: "evt_123",
    object: "event",
    type,
    created: 1_789_000_000,
    livemode: false,
    data: { object: { id: "du_123", object: "dispute" } },
    ...overrides,
  });
}

function sign(payload: string, secret = SECRET, timestamp?: number) {
  return Stripe.webhooks.generateTestHeaderString({ payload, secret, timestamp });
}

function storeReturning(result: "stored" | "duplicate") {
  return vi.fn<StoreEvent>().mockResolvedValue(result);
}

describe("isHandledEventType", () => {
  it("accepts payment_intent, charge.dispute, and invoice events", () => {
    expect(isHandledEventType("payment_intent.payment_failed")).toBe(true);
    expect(isHandledEventType("charge.dispute.created")).toBe(true);
    expect(isHandledEventType("invoice.payment_failed")).toBe(true);
  });

  it("rejects everything else", () => {
    expect(isHandledEventType("charge.succeeded")).toBe(false);
    expect(isHandledEventType("invoice_payment.paid")).toBe(false);
    expect(isHandledEventType("customer.created")).toBe(false);
  });
});

describe("handleWebhook", () => {
  it("stores a correctly signed handled event", async () => {
    const payload = event("charge.dispute.created", { account: "acct_connected" });
    const store = storeReturning("stored");
    const result = await handleWebhook({ payload, signature: sign(payload), secret: SECRET }, store);
    expect(result).toEqual({ status: 200, body: { received: true } });
    expect(store).toHaveBeenCalledOnce();
    expect(store.mock.calls[0]![0]).toMatchObject({ id: "evt_123", type: "charge.dispute.created", account: "acct_connected" });
  });

  it("reports duplicates without failing, so Stripe stops retrying", async () => {
    const payload = event("invoice.payment_failed");
    const result = await handleWebhook({ payload, signature: sign(payload), secret: SECRET }, storeReturning("duplicate"));
    expect(result).toEqual({ status: 200, body: { received: true, duplicate: true } });
  });

  it("rejects a missing signature header", async () => {
    const store = storeReturning("stored");
    const result = await handleWebhook({ payload: event("invoice.paid"), signature: null, secret: SECRET }, store);
    expect(result.status).toBe(400);
    expect(store).not.toHaveBeenCalled();
  });

  it("rejects a signature made with a different secret", async () => {
    const payload = event("invoice.paid");
    const store = storeReturning("stored");
    const result = await handleWebhook({ payload, signature: sign(payload, "whsec_other"), secret: SECRET }, store);
    expect(result).toEqual({ status: 400, body: { error: "invalid signature" } });
    expect(store).not.toHaveBeenCalled();
  });

  it("rejects a payload changed after signing", async () => {
    const payload = event("invoice.paid");
    const tampered = payload.replace("du_123", "du_999");
    const result = await handleWebhook({ payload: tampered, signature: sign(payload), secret: SECRET }, storeReturning("stored"));
    expect(result.status).toBe(400);
  });

  it("rejects a signature older than the tolerance window", async () => {
    const payload = event("invoice.paid");
    const oldTimestamp = Math.floor(Date.now() / 1000) - 60 * 60;
    const result = await handleWebhook(
      { payload, signature: sign(payload, SECRET, oldTimestamp), secret: SECRET },
      storeReturning("stored"),
    );
    expect(result.status).toBe(400);
  });

  it("returns 500 when the secret is not configured", async () => {
    const payload = event("invoice.paid");
    const result = await handleWebhook({ payload, signature: sign(payload), secret: undefined }, storeReturning("stored"));
    expect(result.status).toBe(500);
  });

  it("acknowledges but does not store unhandled event types", async () => {
    const payload = event("customer.created");
    const store = storeReturning("stored");
    const result = await handleWebhook({ payload, signature: sign(payload), secret: SECRET }, store);
    expect(result).toEqual({ status: 200, body: { received: true, ignored: "unhandled event type" } });
    expect(store).not.toHaveBeenCalled();
  });

  it("acknowledges but does not store live mode events", async () => {
    const payload = event("charge.dispute.created", { livemode: true });
    const store = storeReturning("stored");
    const result = await handleWebhook({ payload, signature: sign(payload), secret: SECRET }, store);
    expect(result.body).toEqual({ received: true, ignored: "live mode event" });
    expect(store).not.toHaveBeenCalled();
  });

  it("returns 500 when storage fails, so Stripe retries", async () => {
    const payload = event("invoice.paid");
    const store = vi.fn<StoreEvent>().mockRejectedValue(new Error("db down"));
    const result = await handleWebhook({ payload, signature: sign(payload), secret: SECRET }, store);
    expect(result).toEqual({ status: 500, body: { error: "storage failed" } });
  });
});
