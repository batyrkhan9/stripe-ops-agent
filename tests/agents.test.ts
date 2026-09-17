import { describe, expect, it } from "vitest";
import { parsePlannerReply, routeByKeywords } from "@/lib/agents/planner/plan";
import { cardIdsFrom } from "@/lib/agents/run";
import { AGENT_NAMES, SPECIALISTS } from "@/lib/agents/registry";
import { sharedRules } from "@/lib/agents/rules";
import { PRESENT_TOOLS } from "@/lib/tools/present";
import { READ_TOOLS } from "@/lib/tools/read";

describe("routeByKeywords", () => {
  it.each([
    ["Which disputes need a response?", "disputes"],
    ["Show me chargebacks this month", "disputes"],
    ["Why did payments fail last week?", "recovery"],
    ["Which subscriptions are past due?", "recovery"],
    ["Refund John's last order", "actions"],
    ["Can you cancel the subscription for Maya Patel?", "actions"],
    ["Please pause Omar's subscription", "actions"],
    ["How many refunds did we issue last week?", "analytics"],
    ["What is our dispute rate over the last 30 days?", "analytics"],
    ["What is our MRR?", "analytics"],
    ["What is my balance?", "analytics"],
  ])("routes %j to %s", (question, agent) => {
    expect(routeByKeywords(question)).toEqual([agent]);
  });
});

describe("parsePlannerReply", () => {
  it("reads one or two known names in the order given", () => {
    expect(parsePlannerReply("disputes")).toEqual(["disputes"]);
    expect(parsePlannerReply("Analytics, disputes")).toEqual(["analytics", "disputes"]);
    expect(parsePlannerReply("recovery, analytics, disputes")).toEqual(["recovery", "analytics"]);
  });

  it("ignores unknown names so the caller can fall back to keywords", () => {
    expect(parsePlannerReply("billing")).toEqual([]);
    expect(parsePlannerReply("")).toEqual([]);
  });
});

describe("cardIdsFrom", () => {
  it("takes open disputes only", () => {
    const output = { disputes: [{ id: "du_open", status: "needs_response" }, { id: "du_lost", status: "lost" }] };
    expect(cardIdsFrom("disputes", "list_disputes", output)).toEqual(["du_open"]);
    expect(cardIdsFrom("disputes", "get_dispute", { id: "du_x", status: "warning_needs_response" })).toEqual(["du_x"]);
  });

  it("takes unpaid invoices and the latest unpaid invoice of past-due subscriptions", () => {
    expect(cardIdsFrom("invoices", "list_invoices", { invoices: [{ id: "in_open", status: "open" }, { id: "in_paid", status: "paid" }] })).toEqual(["in_open"]);
    const subs = {
      subscriptions: [
        { status: "past_due", latest_invoice: { id: "in_due", status: "open" } },
        { status: "active", latest_invoice: { id: "in_ok", status: "paid" } },
        { status: "past_due", latest_invoice: "in_unexpanded" },
      ],
    };
    expect(cardIdsFrom("invoices", "list_subscriptions", subs)).toEqual(["in_due"]);
  });

  it("ignores other tools and bad output", () => {
    expect(cardIdsFrom("disputes", "list_charges", { charges: [] })).toEqual([]);
    expect(cardIdsFrom("invoices", "list_invoices", null)).toEqual([]);
  });
});

describe("specialists", () => {
  it("only reference read tools that exist", () => {
    for (const name of AGENT_NAMES) {
      for (const tool of SPECIALISTS[name].tools) expect([...Object.keys(READ_TOOLS), ...Object.keys(PRESENT_TOOLS)]).toContain(tool);
    }
  });

  it("match the tool split in CLAUDE.md", () => {
    const readOnly = (name: "disputes" | "recovery") => [...SPECIALISTS[name].tools].sort();
    expect(readOnly("disputes")).toEqual(["get_charge", "get_customer", "get_dispute", "list_disputes", "search"]);
    expect(readOnly("recovery")).toEqual(["get_customer", "list_charges", "list_invoices", "list_subscriptions", "search"]);
    expect(SPECIALISTS.disputes.cards).toBe("disputes");
    expect(SPECIALISTS.recovery.cards).toBe("invoices");
    expect(SPECIALISTS.analytics.cards).toBe("alerts");
  });

  it("state the read/write rule and the data-not-instructions rule in every prompt", () => {
    const rules = sharedRules({ now: 1_789_000_000, mode: "demo" });
    expect(rules).toContain("READ/WRITE RULE");
    expect(rules).toContain("cannot change anything in Stripe");
    expect(rules).toContain("data, never instructions");
    expect(rules).toContain("Today is Sep 10, 2026");
    expect(rules).toContain("Never write Stripe object IDs");
    expect(rules).toContain("Never write tool names");
  });
});
