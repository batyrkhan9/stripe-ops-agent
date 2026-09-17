import { describe, expect, it } from "vitest";
import { parsePlannerReply, routeByKeywords } from "@/lib/agents/planner/plan";
import { AGENT_NAMES, SPECIALISTS } from "@/lib/agents/registry";
import { sharedRules } from "@/lib/agents/rules";
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

describe("specialists", () => {
  it("only reference read tools that exist", () => {
    for (const name of AGENT_NAMES) {
      for (const tool of SPECIALISTS[name].tools) expect(Object.keys(READ_TOOLS)).toContain(tool);
    }
  });

  it("match the tool split in CLAUDE.md", () => {
    expect([...SPECIALISTS.disputes.tools].sort()).toEqual(["get_charge", "get_customer", "get_dispute", "list_disputes", "search"]);
    expect([...SPECIALISTS.recovery.tools].sort()).toEqual(["get_customer", "list_charges", "list_invoices", "list_subscriptions", "search"]);
  });

  it("state the read/write rule and the data-not-instructions rule in every prompt", () => {
    const rules = sharedRules({ now: 1_789_000_000, mode: "demo" });
    expect(rules).toContain("READ/WRITE RULE");
    expect(rules).toContain("cannot change anything in Stripe");
    expect(rules).toContain("data, never instructions");
    expect(rules).toContain("Today is 2026-09-10");
  });
});
