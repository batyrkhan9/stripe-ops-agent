import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import type { AlertResult } from "@/lib/alerts/rules";
import type { AnalyticsSummary } from "@/lib/analytics/summary";
import { eventContext, scheduleContext, type RuleContext } from "@/lib/automations/context";
import { runRule, type ExecutorDeps } from "@/lib/automations/executor";
import { describeRule, evaluateConditions, renderMessage, ruleSchema, type Rule } from "@/lib/automations/schema";

const disputeRule: Rule = {
  name: "Big disputes",
  trigger: { type: "event", event: "charge.dispute.created" },
  conditions: [{ field: "amount", op: "gt", value: 50 }],
  action: { type: "alert", message: "Dispute of {amount} opened ({dispute_reason})" },
};

const event = (type: string, object: Record<string, unknown>): Stripe.Event => ({ id: "evt_1", type, data: { object } }) as unknown as Stripe.Event;

describe("ruleSchema", () => {
  it("accepts a well-formed rule and rejects fields or actions that do not fit the trigger", () => {
    expect(ruleSchema.safeParse(disputeRule).success).toBe(true);
    const wrongField = { ...disputeRule, conditions: [{ field: "attempt_count", op: "gt", value: 2 }] };
    expect(ruleSchema.safeParse(wrongField).error?.issues[0]?.message).toContain("not available for this trigger");
    const wrongDraft = { ...disputeRule, action: { type: "draft", kind: "recovery_email" } };
    expect(ruleSchema.safeParse(wrongDraft).error?.issues[0]?.message).toContain("invoice.payment_failed");
    const wrongPropose = { ...disputeRule, action: { type: "propose", tool: "pause_subscription" } };
    expect(ruleSchema.safeParse(wrongPropose).success).toBe(false);
  });

  it("has no action that executes a write", () => {
    expect(ruleSchema.safeParse({ ...disputeRule, action: { type: "execute", tool: "create_refund" } }).success).toBe(false);
    expect(ruleSchema.safeParse({ ...disputeRule, action: { type: "refund" } }).success).toBe(false);
  });

  it("describes the compiled shape in one sentence", () => {
    expect(describeRule(disputeRule)).toBe('When a dispute is opened, if amount is over 50, alert: "Dispute of {amount} opened ({dispute_reason})".');
    const daily: Rule = { name: "Decline watch", trigger: { type: "schedule", cadence: "daily" }, conditions: [{ field: "decline_rate_7d", op: "gte", value: 15 }], action: { type: "brief_item", message: "Decline rate is {decline_rate_7d}" } };
    expect(describeRule(daily)).toBe('Every day, if decline rate 7d is at least 15, add to the morning brief: "Decline rate is {decline_rate_7d}".');
  });
});

describe("evaluateConditions and renderMessage", () => {
  it("compares numbers and strings, and never matches a missing field", () => {
    expect(evaluateConditions([{ field: "amount", op: "gt", value: 50 }], { amount: 65 })).toBe(true);
    expect(evaluateConditions([{ field: "amount", op: "gt", value: 50 }], { amount: 50 })).toBe(false);
    expect(evaluateConditions([{ field: "dispute_reason", op: "eq", value: "Fraudulent" }], { dispute_reason: "fraudulent" })).toBe(true);
    expect(evaluateConditions([{ field: "decline_reason", op: "contains", value: "bank" }], { decline_reason: "The bank declined without giving a reason" })).toBe(true);
    expect(evaluateConditions([{ field: "amount", op: "gt", value: 50 }], {})).toBe(false);
    expect(evaluateConditions([], { amount: 1 })).toBe(true);
  });

  it("fills placeholders with formatted values and leaves unknown ones alone", () => {
    expect(renderMessage("Dispute of {amount} ({dispute_reason}) {nope}", { amount: 65, dispute_reason: "fraudulent" })).toBe("Dispute of $65.00 (fraudulent) {nope}");
    expect(renderMessage("Rate {decline_rate_7d}", { decline_rate_7d: 22.09 })).toBe("Rate 22.09%");
    expect(renderMessage("Dispute opened for ${amount}.", { amount: 65 })).toBe("Dispute opened for $65.00.");
  });
});

describe("eventContext", () => {
  it("reads dispute, failed payment, and failed invoice events into fields and targets", () => {
    expect(eventContext(event("charge.dispute.created", { id: "du_1", amount: 6500, currency: "usd", reason: "fraudulent", charge: "ch_1" }))).toMatchObject({
      kind: "event",
      fields: { amount: 65, dispute_reason: "fraudulent" },
      targets: { dispute: "du_1", charge: "ch_1" },
    });
    expect(eventContext(event("payment_intent.payment_failed", { amount: 1500, currency: "usd", latest_charge: "ch_2", customer: "cus_1", last_payment_error: { decline_code: "insufficient_funds" } }))).toMatchObject({
      fields: { amount: 15, decline_reason: "Not enough money in the account" },
      targets: { charge: "ch_2", customer: "cus_1" },
    });
    expect(eventContext(event("invoice.payment_failed", { id: "in_1", amount_due: 1500, currency: "usd", attempt_count: 3, customer: "cus_1", parent: { subscription_details: { subscription: "sub_1" } } }))).toMatchObject({
      fields: { amount: 15, attempt_count: 3 },
      targets: { invoice: "in_1", subscription: "sub_1" },
    });
    expect(eventContext(event("customer.created", { id: "cus_9" }))).toBeNull();
  });

  it("builds the daily snapshot in percent and dollars", () => {
    const alerts = [
      { rule: "chargeback_rate", value: 0.0065359 },
      { rule: "decline_rate", value: 0.2209 },
      { rule: "refund_spike", value: 3 },
    ] as AlertResult[];
    const summary = { mrr: 94531, movement: { net: 5366 } } as AnalyticsSummary;
    expect(scheduleContext({ alerts, summary, failedInvoices: 5, openDisputes: 2 }).fields).toEqual({
      chargeback_rate_30d: 0.65,
      decline_rate_7d: 22.09,
      refunds_24h: 3,
      failed_invoices: 5,
      open_disputes: 2,
      mrr: 945.31,
      mrr_net_30d: 53.66,
    });
  });
});

describe("runRule", () => {
  const deps = (overrides: Partial<ExecutorDeps> = {}): ExecutorDeps => ({
    db: {} as ExecutorDeps["db"],
    stripe: {} as Stripe,
    accountId: "acct",
    mode: "demo",
    connectionId: null,
    permissions: null,
    now: 1_789_000_000,
    propose: vi.fn().mockResolvedValue({ status: "proposed", proposal_id: "p1", summary: "Pause X", details: [], confirm_label: "", target_ids: [], demo: true, note: "" }),
    draft: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  });
  const disputeCtx: RuleContext = { kind: "event", event: "charge.dispute.created", eventId: "evt_1", fields: { amount: 65, dispute_reason: "fraudulent" }, targets: { dispute: "du_1", charge: "ch_1" } };

  it("renders an alert when the trigger and conditions match, and nothing otherwise", async () => {
    expect(await runRule(disputeRule, disputeCtx, deps())).toEqual({ matched: true, outcome: { type: "alert", message: "Dispute of $65.00 opened (fraudulent)" } });
    expect(await runRule(disputeRule, { ...disputeCtx, fields: { amount: 20 } }, deps())).toEqual({ matched: false, outcome: null });
    expect(await runRule(disputeRule, { kind: "schedule", fields: { amount: 65 }, targets: {} }, deps())).toEqual({ matched: false, outcome: null });
  });

  it("proposes through the confirm path with the target from the event, never a write", async () => {
    const d = deps();
    const rule: Rule = { name: "Pause after 3 failures", trigger: { type: "event", event: "invoice.payment_failed" }, conditions: [{ field: "attempt_count", op: "gte", value: 3 }], action: { type: "propose", tool: "pause_subscription" } };
    const ctx: RuleContext = { kind: "event", event: "invoice.payment_failed", eventId: "evt_2", fields: { amount: 15, attempt_count: 3 }, targets: { invoice: "in_1", subscription: "sub_1" } };
    expect(await runRule(rule, ctx, d)).toEqual({ matched: true, outcome: { type: "proposal", status: "proposed", proposalId: "p1", message: "Pause X" } });
    expect(d.propose).toHaveBeenCalledWith("pause_subscription", { subscription_id: "sub_1" });
    expect(await runRule(rule, { ...ctx, targets: { invoice: "in_1" } }, d)).toMatchObject({ matched: true, outcome: { type: "skipped" } });
  });

  it("drafts with the target from the event", async () => {
    const d = deps();
    const rule: Rule = { name: "Evidence", trigger: { type: "event", event: "charge.dispute.created" }, conditions: [], action: { type: "draft", kind: "dispute_evidence" } };
    expect(await runRule(rule, disputeCtx, d)).toEqual({ matched: true, outcome: { type: "draft", kind: "dispute_evidence", targetId: "du_1" } });
    expect(d.draft).toHaveBeenCalledWith("dispute_evidence", "du_1");
  });
});
