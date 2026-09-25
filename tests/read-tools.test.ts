import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import { READ_TOOLS } from "@/lib/tools/read";
import { collectByDate, executeReadTool, type AuditRecord, type ToolContext } from "@/lib/tools/types";

const NOW = 1_789_000_000;
const DAY = 86_400;

async function* pages<T>(items: T[]) {
  yield* items;
}

function context(stripe: Partial<Record<string, unknown>>, audit = vi.fn<(r: AuditRecord) => Promise<void>>().mockResolvedValue()) {
  const onToolResult = vi.fn();
  const ctx: ToolContext = { stripe: stripe as unknown as Stripe, agent: "analytics", now: NOW, audit, onToolResult };
  return { ctx, audit, onToolResult };
}

describe("read tool input validation", () => {
  it("rejects malformed Stripe IDs", () => {
    expect(READ_TOOLS.get_charge.input.safeParse({ id: "ch_3UGX7q3FpwYTqedq0mOgxgsY" }).success).toBe(true);
    expect(READ_TOOLS.get_charge.input.safeParse({ id: "cus_3UGX7q3FpwYTqedq" }).success).toBe(false);
    expect(READ_TOOLS.get_dispute.input.safeParse({ id: "du_1; drop table" }).success).toBe(false);
    expect(READ_TOOLS.get_customer.input.safeParse({ id: "" }).success).toBe(false);
  });

  it("bounds limits and days, and rejects unknown enum values", () => {
    expect(READ_TOOLS.list_charges.input.safeParse({ limit: 26 }).success).toBe(false);
    expect(READ_TOOLS.list_charges.input.safeParse({ limit: 0 }).success).toBe(false);
    expect(READ_TOOLS.list_charges.input.safeParse({ days: 0 }).success).toBe(false);
    expect(READ_TOOLS.list_disputes.input.safeParse({ status: "pending" }).success).toBe(false);
    expect(READ_TOOLS.search.input.safeParse({ resource: "payouts", query: "status:'paid'" }).success).toBe(false);
  });

  it("applies defaults", () => {
    expect(READ_TOOLS.list_invoices.input.parse({})).toMatchObject({ status: "all", limit: 10 });
  });

  it("exposes the ten read tools from CLAUDE.md plus get_metrics", () => {
    expect(Object.keys(READ_TOOLS).sort()).toEqual(
      ["get_balance", "get_charge", "get_customer", "get_dispute", "get_metrics", "list_charges", "list_customers", "list_disputes", "list_invoices", "list_subscriptions", "search"],
    );
  });
});

describe("executeReadTool", () => {
  it("audits every call with the Stripe IDs it returned", async () => {
    const { ctx, audit, onToolResult } = context({
      balance: { retrieve: async () => ({ available: [{ amount: 12345, currency: "usd" }], pending: [] }) },
    });
    const output = await executeReadTool(READ_TOOLS.get_balance, {}, ctx);
    expect(output).toEqual({ available: ["$123.45"], pending: [] });
    expect(audit).toHaveBeenCalledWith({ agent: "analytics", tool: "get_balance", params: {}, stripeIds: [], result: output });
    expect(onToolResult).toHaveBeenCalledWith(expect.objectContaining({ tool: "get_balance", ok: true }));
  });

  it("audits invalid input without calling Stripe", async () => {
    const retrieve = vi.fn();
    const { ctx, audit } = context({ charges: { retrieve } });
    const output = await executeReadTool(READ_TOOLS.get_charge, { id: "not-an-id" }, ctx);
    expect(output).toMatchObject({ error: "invalid_input" });
    expect(retrieve).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledOnce();
  });

  it("returns Stripe errors to the model with secrets redacted", async () => {
    const { ctx, onToolResult } = context({
      balance: {
        retrieve: async () => {
          throw Object.assign(new Error("Invalid API Key provided: rk_test_51abcdef****wxyz"), { type: "StripeAuthenticationError" });
        },
      },
    });
    const output = (await executeReadTool(READ_TOOLS.get_balance, {}, ctx)) as { error: string; message: string };
    expect(output.error).toBe("StripeAuthenticationError");
    expect(output.message).not.toContain("rk_test_");
    expect(onToolResult).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
  });
});

describe("collectByDate", () => {
  const item = (id: string, created: number, seeded?: number) => ({
    id,
    created,
    metadata: (seeded ? { seed_occurred_at: String(seeded) } : {}) as Record<string, string>,
  });

  it("filters and sorts by intended date, not created", async () => {
    const items = [
      item("recent_seeded", NOW, NOW - 2 * DAY),
      item("old_seeded", NOW, NOW - 40 * DAY),
      item("real_recent", NOW - 1 * DAY),
      item("future", NOW + DAY),
    ];
    const result = await collectByDate(pages(items), { now: NOW, days: 30 });
    expect(result.map((i) => i.id)).toEqual(["real_recent", "recent_seeded"]);
  });

  it("skips documented experiment leftovers", async () => {
    const items = [item("seeded", NOW, NOW - DAY), { id: "leftover", created: NOW - DAY, metadata: { seed_key: "experiment" } }];
    expect((await collectByDate(pages(items), { now: NOW })).map((i) => i.id)).toEqual(["seeded"]);
  });

  it("drops objects created after now even when they carry a seeded date inside the window", async () => {
    // Stripe's automatic retries copy seed_occurred_at from the invoice's payment intent onto new charges.
    const items = [item("seed_run", NOW + 600, NOW - DAY), item("later_retry", NOW + 7 * DAY, NOW - DAY)];
    expect((await collectByDate(pages(items), { now: NOW, days: 7 })).map((i) => i.id)).toEqual(["seed_run"]);
  });

  it("stops after maxScan objects", async () => {
    const items = Array.from({ length: 50 }, (_, i) => item(`x${i}`, NOW - i));
    expect(await collectByDate(pages(items), { now: NOW, maxScan: 10 })).toHaveLength(10);
  });
});

describe("list_charges totals", () => {
  it("counts by status and decline code over the requested window", async () => {
    const charge = (id: string, status: string, daysAgo: number, extra: object = {}) => ({
      id: `ch_${id.padEnd(12, "x")}`,
      created: NOW,
      status,
      amount: 1000,
      amount_refunded: 0,
      currency: "usd",
      disputed: false,
      metadata: { seed_occurred_at: String(NOW - daysAgo * DAY) },
      ...extra,
    });
    const charges = [
      charge("a", "succeeded", 1, { disputed: true }),
      charge("b", "succeeded", 2, { amount_refunded: 500 }),
      charge("c", "failed", 3, { outcome: { reason: "insufficient_funds" } }),
      charge("d", "failed", 20, { outcome: { reason: "generic_decline" } }),
    ];
    const { ctx } = context({ charges: { list: () => pages(charges) } });
    const output = (await executeReadTool(READ_TOOLS.list_charges, { days: 7, limit: 2 }, ctx)) as {
      totals: Record<string, unknown>;
      charges: unknown[];
    };
    expect(output.totals).toMatchObject({
      matching: 3,
      succeeded: 2,
      failed: 1,
      disputed: 1,
      gross_succeeded: ["$20.00"],
      refunded: ["$5.00"],
      refunded_charges: 1,
      decline_reasons: [{ reason: "Not enough money in the account", count: 1, retry: "later", customer_action: "Top up the account or use another card" }],
    });
    expect(output.charges).toHaveLength(2);
  });
});

describe("list_disputes", () => {
  const dispute = (id: string, status: string, daysAgo: number) => ({
    id: `du_${id.repeat(14)}`,
    status,
    reason: "fraudulent",
    amount: 6500,
    currency: "usd",
    created: NOW - daysAgo * DAY,
    metadata: {},
    evidence_details: { due_by: NOW + 8 * DAY, submission_count: 0 },
    charge: { id: `ch_${id.repeat(14)}`, metadata: { order_id: "KC-10299" }, customer: { id: `cus_${id.repeat(14)}`, name: "Ethan Nguyen", email: "ethan@example.com" } },
  });

  it("lists every open dispute whatever its age, with the customer's name", async () => {
    const list = vi.fn(() => pages([dispute("a", "needs_response", 2), dispute("b", "needs_response", 11), dispute("c", "won", 40)]));
    const { ctx } = context({ disputes: { list } });
    const output = (await executeReadTool(READ_TOOLS.list_disputes, { status: "open", days: 7 }, ctx)) as {
      matching: number;
      note?: string;
      disputes: { customer_name?: string; deadline?: string }[];
    };
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ expand: ["data.charge.customer"] }));
    expect(output.matching).toBe(2);
    expect(output.note).toMatch(/ignored/);
    expect(JSON.stringify(output.disputes[0])).toContain("Ethan Nguyen");
    expect(output.disputes[0]!.deadline).toMatch(/^due \w{3} \d+, in 8 days$/);
  });

  it("still applies days to closed statuses", async () => {
    const { ctx } = context({ disputes: { list: () => pages([dispute("a", "won", 2), dispute("b", "won", 40)]) } });
    const output = (await executeReadTool(READ_TOOLS.list_disputes, { status: "won", days: 30 }, ctx)) as { matching: number };
    expect(output.matching).toBe(1);
  });
});
