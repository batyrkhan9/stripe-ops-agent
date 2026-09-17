import { describe, expect, it } from "vitest";
import { productName, retrySchedule, type RecoveryFacts } from "@/lib/agents/recovery/plan";
import { explainDecline } from "@/lib/stripe/declines";

const NOW = 1_789_000_000;
const DAY = 86_400;

const facts = (code: string, lastAttempt: number | null): RecoveryFacts => ({
  invoiceId: "in_1",
  customerName: "Tomas Kowalski",
  customerEmail: null,
  product: "Classic Box",
  amount: "$15.00",
  attempts: 1,
  declineCode: code,
  decline: explainDecline(code),
  lastAttempt,
  stripeNextAttempt: null,
});

describe("retrySchedule", () => {
  it("spaces soft decline retries from the last attempt", () => {
    const steps = retrySchedule(facts("insufficient_funds", NOW - DAY), NOW);
    expect(steps.map((s) => (s.at - (NOW - DAY)) / DAY)).toEqual([3, 5, 7, 14]);
    expect(steps[1]!.action).toContain("top up the account");
  });

  it("never schedules in the past: an overdue first step moves to today and the spacing holds", () => {
    const steps = retrySchedule(facts("generic_decline", NOW - 12 * DAY), NOW);
    expect(steps[0]).toMatchObject({ at: NOW, label: "Today" });
    expect(steps.map((s) => (s.at - NOW) / DAY)).toEqual([0, 2, 4, 11]);
    expect(steps.every((s) => s.at >= NOW)).toBe(true);
  });

  it("does not retry hard declines, and asks for a new card today", () => {
    const steps = retrySchedule(facts("expired_card", NOW - 2 * DAY), NOW);
    expect(steps[0]!.action).toMatch(/update their card\. Retrying this card will not work/);
    expect(steps.some((s) => /^Retry/.test(s.action))).toBe(false);
  });
});

describe("productName", () => {
  it("reads the product from invoice line descriptions", () => {
    expect(productName("Remaining time on Classic Box after 17 Sep 2026")).toBe("Classic Box");
    expect(productName("1 × Deluxe Box (at $39.00 / month)")).toBe("Deluxe Box");
    expect(productName("Custom service")).toBe("Custom service");
    expect(productName(null)).toBe("subscription");
  });
});
