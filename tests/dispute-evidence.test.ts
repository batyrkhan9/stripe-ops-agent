import type Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { factsText } from "@/lib/agents/disputes/draft";
import { carrierFromTracking, evidenceFacts, prefilledEvidence } from "@/lib/agents/disputes/evidence";

const NOW = 1_789_000_000;
const DAY = 86_400;

const charge = (id: string, daysAgo: number, extra: Record<string, unknown> = {}) =>
  ({ id, status: "succeeded", disputed: false, created: NOW, metadata: { seed_occurred_at: String(NOW - daysAgo * DAY) }, ...extra }) as unknown as Stripe.Charge;

const dispute = {
  id: "du_1UGX7p3FpwYTqedqcy6JowYK",
  reason: "product_not_received",
  status: "needs_response",
  amount: 2800,
  currency: "usd",
  evidence_details: { due_by: NOW + 8 * DAY },
  charge: {
    id: "ch_disputed000001",
    description: "Order KC-10300: 1x Tasting Flight",
    amount_refunded: 0,
    currency: "usd",
    created: NOW,
    metadata: { seed_occurred_at: String(NOW - 7 * DAY), order_id: "KC-10300", shipping_tracking: "1ZKC473508949907" },
    customer: { id: "cus_camila0000001", name: "Camila Torres", email: "camila@example.com" },
    payment_method_details: { card: { brand: "visa", last4: "1976", country: "US", checks: { cvc_check: "pass", address_postal_code_check: null } } },
  },
} as unknown as Stripe.Dispute;

describe("evidenceFacts", () => {
  it("collects the facts a bank reviewer needs from Stripe data only", () => {
    const history = [charge("ch_disputed000001", 7), charge("ch_old1", 40), charge("ch_old2", 70), charge("ch_later", 1), charge("ch_failed", 50, { status: "failed" })];
    const facts = evidenceFacts(dispute, NOW, history);
    expect(facts).toMatchObject({
      reasonLabel: "Product not received",
      amount: "$28.00",
      due: expect.stringMatching(/^due \w{3} \d+, in 8 days$/),
      orderId: "KC-10300",
      trackingNumber: "1ZKC473508949907",
      carrier: null,
      customerName: "Camila Torres",
      card: "Visa ending 1976, US",
      checks: ["CVC check passed"],
      refunded: null,
    });
    expect(facts.customerHistory).toMatch(/^2 earlier successful payments since \w{3} \d+, no other disputes$/);
  });

  it("prefills contact and tracking, and marks what only the merchant knows", () => {
    const fields = prefilledEvidence(evidenceFacts(dispute, NOW, []));
    expect(fields).toEqual({
      customer_name: "Camila Torres",
      customer_email_address: "camila@example.com",
      shipping_tracking_number: "1ZKC473508949907",
      shipping_carrier: "[fill in: carrier]",
      shipping_date: "[fill in: ship date]",
    });
  });

  it("gives the model reason guidance and facts as plain text, without IDs", () => {
    const text = factsText(evidenceFacts(dispute, NOW, []));
    expect(text).toContain("says the order never arrived");
    expect(text).toContain("tracking 1ZKC473508949907");
    expect(text).not.toMatch(/\b(du|ch|cus)_/);
  });
});

describe("carrierFromTracking", () => {
  it("recognizes only well-formed UPS numbers", () => {
    expect(carrierFromTracking("1Z999AA10123456784")).toBe("UPS");
    expect(carrierFromTracking("1ZKC473508949907")).toBeNull();
    expect(carrierFromTracking(null)).toBeNull();
  });
});
