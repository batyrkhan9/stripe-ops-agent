import type Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { buildSources, sourcesText } from "@/lib/agents/sources";
import { businessMetadata, effectiveTime, formatCharge, redactSecrets, stripeIdsIn } from "@/lib/tools/format";

const CH = "ch_3UGX7q3FpwYTqedq0mOgxgsY";
const DU = "du_1UGX1c3FpwYTqedqZdxiQeqY";
const CUS = "cus_TAbcdefghijk12";

describe("effectiveTime", () => {
  it("prefers the seeded intended date", () => {
    expect(effectiveTime({ created: 2000, metadata: { seed_occurred_at: "1000" } })).toBe(1000);
  });

  it("falls back to created for real objects or bad metadata", () => {
    expect(effectiveTime({ created: 2000, metadata: {} })).toBe(2000);
    expect(effectiveTime({ created: 2000, metadata: { seed_occurred_at: "nope" } })).toBe(2000);
    expect(effectiveTime({ created: 2000 })).toBe(2000);
  });
});

describe("businessMetadata", () => {
  it("hides seed bookkeeping but keeps order data", () => {
    expect(businessMetadata({ seed: "true", seed_key: "payment:001", seed_occurred_at: "1", order_id: "KC-1", shipping_tracking: "1Z" })).toEqual({
      order_id: "KC-1",
      shipping_tracking: "1Z",
    });
    expect(businessMetadata({ seed: "true" })).toBeUndefined();
  });
});

describe("formatCharge", () => {
  it("labels amounts and dates, exposes decline codes, and uses the intended date", () => {
    const charge = {
      id: CH,
      created: 1_789_000_000,
      status: "failed",
      amount: 12900,
      amount_refunded: 0,
      currency: "usd",
      customer: CUS,
      description: "Order KC-10001",
      disputed: false,
      failure_code: "card_declined",
      failure_message: "Your card was declined.",
      outcome: { reason: "insufficient_funds" },
      payment_intent: "pi_123",
      payment_method_details: { card: { brand: "visa", country: "US" } },
      metadata: { seed: "true", seed_occurred_at: "1788000000", order_id: "KC-10001" },
    } as unknown as Stripe.Charge;
    expect(formatCharge(charge)).toMatchObject({
      id: CH,
      amount: "$129.00",
      date: "Aug 29",
      failure: { code: "card_declined", decline_code: "insufficient_funds" },
      card: { brand: "visa", country: "US" },
      metadata: { order_id: "KC-10001" },
    });
  });
});

describe("redactSecrets", () => {
  it("removes API keys and webhook secrets from error text", () => {
    const text = `Invalid API Key provided: rk_test_51abc****wxyz and sk_${"live"}_abc and whsec_abc123`;
    const redacted = redactSecrets(text);
    expect(redacted).not.toMatch(/rk_test_|sk_live_|whsec_/);
    expect(redacted).toContain("[redacted]");
  });
});

describe("stripeIdsIn", () => {
  it("finds Stripe object IDs in nested output without duplicates", () => {
    expect(stripeIdsIn({ a: CH, b: [DU, CH], c: "order KC-10001" }).sort()).toEqual([CH, DU].sort());
  });
});

describe("buildSources", () => {
  it("cites cards and declared IDs that tools returned, and flags the rest", () => {
    const fake = "ch_FAKEFAKEFAKEFAKE1";
    const sources = buildSources({
      answer: "Two disputes are due Sep 25.",
      toolIds: new Set([CH, DU, CUS]),
      toolsCalled: ["list_disputes", "show_disputes", "list_disputes", "finish_answer"],
      cardIds: [DU],
      declaredIds: [DU, CH, fake],
    });
    expect(sources).toEqual({ cited: [DU, CH], unverified: [fake], tools: ["list_disputes", "show_disputes"] });
    expect(sourcesText(sources)).toContain(`Sources: ${DU}, ${CH}`);
    expect(sourcesText(sources)).toContain(`Not found in tool results: ${fake}`);
  });

  it("still checks IDs that leak into the answer body", () => {
    expect(buildSources({ answer: `See ${CH}`, toolIds: new Set([CH]), toolsCalled: ["get_charge"] }).cited).toEqual([CH]);
  });

  it("says so when nothing was cited", () => {
    expect(sourcesText(buildSources({ answer: "No data.", toolIds: new Set(), toolsCalled: [] }))).toBe(
      "Sources: no Stripe objects cited. No tools were used.",
    );
    expect(sourcesText(buildSources({ answer: "Totals only.", toolIds: new Set([CH]), toolsCalled: ["list_charges"] }))).toBe(
      "Sources: no Stripe objects cited. Looked at: list_charges.",
    );
  });
});
