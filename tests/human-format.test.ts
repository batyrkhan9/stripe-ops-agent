import type Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { dateLabel, dueLabel, moneyLabel, titleCase } from "@/lib/format/human";
import { explainDecline } from "@/lib/stripe/declines";
import { finishAnswer } from "@/lib/tools/present/finish-answer";
import { disputeCard } from "@/lib/tools/present/show-disputes";
import type { ToolContext } from "@/lib/tools/types";

// 2026-09-16 04:39 UTC
const NOW = 1_789_533_540;
const DAY = 86_400;

describe("labels", () => {
  it("formats money", () => {
    expect(moneyLabel(6500, "usd")).toBe("$65.00");
    expect(moneyLabel(123456, "usd")).toBe("$1,234.56");
    expect(moneyLabel(990, "eur")).toBe("9.90 EUR");
  });

  it("formats dates, adding the year only when it differs", () => {
    expect(dateLabel(NOW + 9 * DAY, NOW)).toBe("Sep 25");
    expect(dateLabel(NOW - 365 * DAY, NOW)).toBe("Sep 16, 2025");
  });

  it("formats deadlines the way answers must", () => {
    expect(dueLabel(NOW + 9 * DAY, NOW)).toBe("due Sep 25, in 9 days");
    expect(dueLabel(NOW + DAY, NOW)).toBe("due Sep 17, tomorrow");
    expect(dueLabel(NOW + 60, NOW)).toBe("due Sep 16, today");
    expect(dueLabel(NOW - 3 * DAY, NOW)).toBe("was due Sep 13, 3 days ago");
    expect(dueLabel(null, NOW)).toBe("");
  });

  it("title-cases Stripe enums", () => {
    expect(titleCase("product_not_received")).toBe("Product not received");
  });
});

describe("explainDecline", () => {
  it("explains known codes and falls back for unknown ones", () => {
    expect(explainDecline("insufficient_funds")).toMatchObject({ retry: "later" });
    expect(explainDecline("expired_card").retry).toBe("no");
    expect(explainDecline("weird_new_code").meaning).toBe("Declined (weird new code)");
    expect(explainDecline(null).meaning).toBe("Payment failed");
  });
});

describe("disputeCard", () => {
  it("builds a card with no IDs in the visible text and an urgent flag near the deadline", () => {
    const dispute = {
      id: "du_1UGX7p3FpwYTqedqcy6JowYK",
      amount: 6500,
      currency: "usd",
      reason: "fraudulent",
      status: "needs_response",
      evidence_details: { due_by: NOW + 2 * DAY },
      charge: {
        id: "ch_3UGX7n3FpwYTqedq1Hg1ig9a",
        customer: { id: "cus_x", name: "Ethan Nguyen", email: "ethan@example.com" },
        metadata: { seed: "true", order_id: "KC-10299", shipping_tracking: "1ZKC035897582331" },
      },
    } as unknown as Stripe.Dispute;
    const card = disputeCard(dispute, NOW);
    expect(card).toMatchObject({
      title: "Ethan Nguyen",
      amount: "$65.00",
      reason: "Fraudulent",
      due: "due Sep 18, in 2 days",
      urgent: true,
      details: ["Order KC-10299", "Tracking 1ZKC035897582331"],
      action: { label: "Draft evidence" },
    });
    const visible = [card.title, card.amount, card.reason, card.status, card.due, ...card.details, card.action.label].join(" ");
    expect(visible).not.toMatch(/\b(du|ch|cus)_/);
  });
});

describe("finish_answer", () => {
  it("rejects a next action that names Stripe IDs, so the call is retried", async () => {
    await expect(
      finishAnswer.run({ next_action: "Draft evidence for du_1UGX7p3FpwYTqedqcy6JowYK before Sep 25.", page: "disputes", source_ids: [] }, {} as ToolContext),
    ).rejects.toThrow(/not Stripe IDs/);
  });

  it("maps a page to a button", async () => {
    const output = await finishAnswer.run(
      { next_action: "Draft evidence for Ethan Nguyen's $65.00 dispute before Sep 25.", page: "disputes", source_ids: ["du_1"] },
      {} as ToolContext,
    );
    expect(output).toEqual({
      text: "Draft evidence for Ethan Nguyen's $65.00 dispute before Sep 25.",
      page: "disputes",
      button: { label: "Open disputes", href: "/disputes" },
      source_ids: ["du_1"],
    });
  });

  it("has no button when no page fits", async () => {
    const output = await finishAnswer.run({ next_action: "Nothing needs doing today.", page: "none", source_ids: [] }, {} as ToolContext);
    expect((output as { button: unknown }).button).toBeNull();
  });
});
