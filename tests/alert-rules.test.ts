import { describe, expect, it } from "vitest";
import { chargebackRate, declineRate, evaluateAlerts, percentLabel, refundSpike, type AlertInput, type DatedCharge } from "@/lib/alerts/rules";

const NOW = 1_789_000_000;
const HOUR = 3_600;
const DAY = 24 * HOUR;

const charges = (count: number, status: DatedCharge["status"], ageSeconds: number, prefix: string = status): DatedCharge[] =>
  Array.from({ length: count }, (_, i) => ({ id: `ch_${prefix}${i}`, time: NOW - ageSeconds, status }));

const input = (overrides: Partial<AlertInput>): AlertInput => ({ now: NOW, charges: [], disputes: [], refunds: [], ...overrides });

describe("refundSpike", () => {
  it("fires at 3 refunds in the trailing 24 hours", () => {
    const refunds = [2, 7, 15].map((h, i) => ({ id: `re_${i}`, time: NOW - h * HOUR }));
    const result = refundSpike(input({ refunds }));
    expect(result).toMatchObject({ firing: true, severity: "warning", value: 3, stripeIds: ["re_0", "re_1", "re_2"] });
  });

  it("does not count refunds older than 24 hours or after now", () => {
    const refunds = [
      { id: "re_a", time: NOW - 2 * HOUR },
      { id: "re_b", time: NOW - 7 * HOUR },
      { id: "re_old", time: NOW - DAY - 1 },
      { id: "re_future", time: NOW + HOUR },
    ];
    expect(refundSpike(input({ refunds }))).toMatchObject({ firing: false, severity: null, value: 2 });
  });
});

describe("chargebackRate", () => {
  const disputes = (count: number, age = 5 * DAY) => Array.from({ length: count }, (_, i) => ({ id: `du_${i}`, time: NOW - age }));

  it("warns over 0.5% and stays a warning below Stripe's 0.75%", () => {
    const result = chargebackRate(input({ charges: charges(306, "succeeded", DAY), disputes: disputes(2) }));
    expect(result).toMatchObject({ firing: true, severity: "warning", valueLabel: "0.65%" });
    expect(result.summary).toContain("below Stripe's 0.75%");
  });

  it("is critical at 0.75% or more", () => {
    expect(chargebackRate(input({ charges: charges(400, "succeeded", DAY), disputes: disputes(3) })).severity).toBe("critical");
  });

  it("is quiet at or under 0.5%, and ignores disputes and charges outside 30 days", () => {
    expect(chargebackRate(input({ charges: charges(400, "succeeded", DAY), disputes: disputes(2) })).firing).toBe(false);
    const old = chargebackRate(input({ charges: [...charges(100, "succeeded", DAY), ...charges(50, "succeeded", 40 * DAY, "old")], disputes: disputes(1, 31 * DAY) }));
    expect(old).toMatchObject({ firing: false, value: 0 });
  });

  it("does not divide by zero with no charges", () => {
    expect(chargebackRate(input({ disputes: disputes(1) }))).toMatchObject({ value: 0, firing: false });
  });
});

describe("declineRate", () => {
  it("fires over 15% of attempts in the trailing 7 days", () => {
    const result = declineRate(input({ charges: [...charges(80, "succeeded", DAY), ...charges(18, "failed", DAY)] }));
    expect(result).toMatchObject({ firing: true, valueLabel: "18.37%" });
    expect(result.stripeIds).toHaveLength(18);
  });

  it("ignores pending charges and failures older than 7 days", () => {
    const result = declineRate(input({ charges: [...charges(90, "succeeded", DAY), ...charges(10, "failed", DAY), ...charges(40, "failed", 8 * DAY, "old"), ...charges(20, "pending", DAY)] }));
    expect(result).toMatchObject({ firing: false, value: 0.1 });
  });
});

describe("evaluateAlerts", () => {
  it("returns every rule, chargeback rate first", () => {
    expect(evaluateAlerts(input({})).map((r) => r.rule)).toEqual(["chargeback_rate", "refund_spike", "decline_rate"]);
    expect(percentLabel(0.0065359)).toBe("0.65%");
  });
});

describe("alertRulesForQuestion", async () => {
  const { alertRulesForQuestion } = await import("@/lib/tools/present/show-alerts");
  it("maps rate, refund, and decline questions to their rules", () => {
    expect(alertRulesForQuestion("What is our dispute rate over the last 30 days?")).toEqual(["chargeback_rate"]);
    expect(alertRulesForQuestion("How many refunds did we issue in the last 24 hours?")).toEqual(["refund_spike"]);
    expect(alertRulesForQuestion("What is our decline rate over the last 7 days?")).toEqual(["decline_rate"]);
    expect(alertRulesForQuestion("Anything unusual this week?")).toHaveLength(3);
    expect(alertRulesForQuestion("How much revenue did we collect?")).toEqual([]);
    // Cards must not contradict the window or scope of the question.
    expect(alertRulesForQuestion("What is our decline rate over the last 30 days?")).toEqual([]);
    expect(alertRulesForQuestion("What is the decline rate for Mastercard this week?")).toEqual([]);
    expect(alertRulesForQuestion("How much failed to collect in the last 7 days?")).toEqual([]);
  });
});
