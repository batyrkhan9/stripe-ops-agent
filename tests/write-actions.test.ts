import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import { confirmProposal, type ConfirmDeps, type StoredProposal } from "@/lib/actions/confirm";
import { proposeWrite, type ProposeContext } from "@/lib/actions/propose";
import type { KeyPermissions } from "@/lib/stripe/permissions";
import { WRITE_TOOLS } from "@/lib/tools/write";
import { PLACEHOLDER } from "@/lib/tools/write/submit-dispute-evidence";

const NOW = 1_789_000_000;
const CH = "ch_3UGX7l3FpwYTqedq1mHdEvKD";

const permissions = (write: Partial<KeyPermissions["write"]> = {}): KeyPermissions => ({
  read: { charges: true, customers: true, subscriptions: true, invoices: true, disputes: true, refunds: true, balance: true },
  write: { refunds: false, coupons: false, subscriptions: false, disputes: false, ...write },
  accountId: "acct_test",
});

const charge = (extra: Record<string, unknown> = {}) => ({
  id: CH,
  status: "succeeded",
  amount: 19500,
  amount_refunded: 0,
  currency: "usd",
  disputed: false,
  created: NOW,
  metadata: { seed_occurred_at: String(NOW - 6 * 86_400), order_id: "KC-10046" },
  customer: { id: "cus_VH5HibugMUOjsw", name: "Maya Patel", email: "maya@example.com" },
  ...extra,
});

function proposeContext(overrides: Partial<ProposeContext> = {}) {
  const create = vi.fn();
  const saveProposal = vi.fn().mockResolvedValue("11111111-1111-4111-8111-111111111111");
  const audit = vi.fn().mockResolvedValue(undefined);
  const stripe = { charges: { retrieve: vi.fn().mockResolvedValue(charge()) }, refunds: { create } } as unknown as Stripe;
  const ctx: ProposeContext = {
    stripe,
    now: NOW,
    agent: "actions",
    accountId: "acct_test",
    mode: "connected",
    connectionId: "conn-1",
    permissions: permissions({ refunds: true }),
    saveProposal,
    audit,
    ...overrides,
  };
  return { ctx, create, saveProposal, audit };
}

describe("proposeWrite", () => {
  it("stores a proposal and never calls the write", async () => {
    const { ctx, create, saveProposal, audit } = proposeContext();
    const output = await proposeWrite(WRITE_TOOLS.create_refund, { charge_id: CH }, ctx);
    expect(output).toMatchObject({ status: "proposed", summary: "Refund $195.00 to Maya Patel for the Sep 4 charge (order KC-10046)", demo: false });
    expect(create).not.toHaveBeenCalled();
    expect(saveProposal).toHaveBeenCalledWith(expect.objectContaining({ tool: "create_refund", permission: "refunds", params: { charge_id: CH, reason: "requested_by_customer" } }));
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ tool: "create_refund", stripeIds: [CH, "cus_VH5HibugMUOjsw"] }));
  });

  it("refuses without describing or storing when the connected key cannot write the resource", async () => {
    const { ctx, saveProposal, audit } = proposeContext({ permissions: permissions() });
    const output = await proposeWrite(WRITE_TOOLS.create_refund, { charge_id: CH }, ctx);
    expect(output).toMatchObject({ status: "refused", reason: "read_only_key" });
    expect(saveProposal).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledOnce();
  });

  it("stores demo proposals marked as demo", async () => {
    const { ctx } = proposeContext({ mode: "demo", permissions: null, connectionId: null });
    expect(await proposeWrite(WRITE_TOOLS.create_refund, { charge_id: CH }, ctx)).toMatchObject({ status: "proposed", demo: true });
  });

  it("rejects targets that cannot take the action", async () => {
    const { ctx, saveProposal } = proposeContext();
    (ctx.stripe.charges.retrieve as ReturnType<typeof vi.fn>).mockResolvedValue(charge({ amount_refunded: 19500 }));
    expect(await proposeWrite(WRITE_TOOLS.create_refund, { charge_id: CH }, ctx)).toMatchObject({ status: "rejected", message: "This charge is already fully refunded." });
    (ctx.stripe.charges.retrieve as ReturnType<typeof vi.fn>).mockResolvedValue(charge());
    expect(await proposeWrite(WRITE_TOOLS.create_refund, { charge_id: CH, amount_cents: 20000 }, ctx)).toMatchObject({ status: "rejected" });
    expect(saveProposal).not.toHaveBeenCalled();
  });

  it("validates input before reading Stripe", async () => {
    const { ctx } = proposeContext();
    expect(await proposeWrite(WRITE_TOOLS.create_refund, { charge_id: "cus_nope" }, ctx)).toMatchObject({ status: "error", error: "invalid_input" });
    expect(ctx.stripe.charges.retrieve).not.toHaveBeenCalled();
  });
});

describe("write tool inputs", () => {
  it("needs exactly one discount on a coupon", () => {
    expect(WRITE_TOOLS.create_coupon.input.safeParse({ name: "Winback", percent_off: 20 }).success).toBe(true);
    expect(WRITE_TOOLS.create_coupon.input.safeParse({ name: "Winback" }).success).toBe(false);
    expect(WRITE_TOOLS.create_coupon.input.safeParse({ name: "Winback", percent_off: 20, amount_off_cents: 500 }).success).toBe(false);
    expect(WRITE_TOOLS.create_coupon.input.safeParse({ name: "Winback", percent_off: 20, duration: "repeating" }).success).toBe(false);
  });

  it("detects unfilled evidence placeholders", () => {
    expect(PLACEHOLDER.test("Delivered on [fill in: delivery date]")).toBe(true);
    expect(PLACEHOLDER.test("Delivered on Sep 5")).toBe(false);
  });
});

describe("confirmProposal", () => {
  const proposal = (extra: Partial<StoredProposal> = {}): StoredProposal => ({
    id: "p1",
    accountId: "acct_test",
    connectionId: "conn-1",
    tool: "create_refund",
    permission: "refunds",
    params: { charge_id: CH, reason: "requested_by_customer" },
    status: "proposed",
    targetIds: [CH],
    ...extra,
  });

  function deps(overrides: Partial<ConfirmDeps> = {}, stored = proposal()) {
    const create = vi.fn().mockResolvedValue({ id: "re_3UGX7l3FpwYTqedq1abcdef", status: "succeeded" });
    const stripe = { refunds: { create } } as unknown as Stripe;
    const finish = vi.fn().mockResolvedValue(undefined);
    const audit = vi.fn().mockResolvedValue(undefined);
    const claim = vi.fn().mockResolvedValue(true);
    const d: ConfirmDeps = {
      account: { mode: "connected", accountId: "acct_test", connectionId: "conn-1", permissions: permissions({ refunds: true }), stripe },
      loadProposal: vi.fn().mockResolvedValue(stored),
      claim,
      finish,
      probe: vi.fn().mockResolvedValue(true),
      audit,
      ...overrides,
    };
    return { d, create, finish, audit, claim };
  }

  it("executes once with the proposal ID as the idempotency key and audits before and after", async () => {
    const { d, create, finish, audit } = deps();
    expect(await confirmProposal("p1", d)).toEqual({ ok: true, stripeId: "re_3UGX7l3FpwYTqedq1abcdef", status: "succeeded" });
    expect(create).toHaveBeenCalledExactlyOnceWith({ charge: CH, amount: undefined, reason: "requested_by_customer" }, { idempotencyKey: "proposal:p1" });
    expect(finish).toHaveBeenCalledWith("p1", { status: "executed", result: { id: "re_3UGX7l3FpwYTqedq1abcdef", status: "succeeded" } });
    expect(audit).toHaveBeenCalledTimes(2);
  });

  it("always refuses in demo mode", async () => {
    const { d, create, claim } = deps({ account: { mode: "demo", accountId: "acct_test" } });
    expect(await confirmProposal("p1", d)).toMatchObject({ ok: false, code: "demo" });
    expect(create).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
  });

  it("refuses proposals from another connection", async () => {
    const { d, create } = deps({}, proposal({ connectionId: "conn-2" }));
    expect(await confirmProposal("p1", d)).toMatchObject({ ok: false, code: "wrong_account" });
    expect(create).not.toHaveBeenCalled();
  });

  it("refuses when the stored permission is off or a fresh probe disagrees", async () => {
    const readOnly = deps();
    readOnly.d.account = { ...(readOnly.d.account as Extract<ConfirmDeps["account"], { mode: "connected" }>), permissions: permissions() };
    expect(await confirmProposal("p1", readOnly.d)).toMatchObject({ ok: false, code: "no_permission" });
    const revoked = deps({ probe: vi.fn().mockResolvedValue(false) });
    expect(await confirmProposal("p1", revoked.d)).toMatchObject({ ok: false, code: "permission_revoked" });
    expect(readOnly.create).not.toHaveBeenCalled();
    expect(revoked.create).not.toHaveBeenCalled();
  });

  it("does not run twice when a second confirm loses the claim or the proposal is decided", async () => {
    const raced = deps({ claim: vi.fn().mockResolvedValue(false) });
    expect(await confirmProposal("p1", raced.d)).toMatchObject({ ok: false, code: "not_pending" });
    const done = deps({}, proposal({ status: "executed" }));
    expect(await confirmProposal("p1", done.d)).toMatchObject({ ok: false, code: "not_pending" });
    expect(raced.create).not.toHaveBeenCalled();
    expect(done.create).not.toHaveBeenCalled();
  });

  it("does not run a write that cannot be audited", async () => {
    const { d, create, finish } = deps({ audit: vi.fn().mockRejectedValue(new Error("db down")) });
    expect(await confirmProposal("p1", d)).toMatchObject({ ok: false, code: "audit_failed" });
    expect(create).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledWith("p1", expect.objectContaining({ status: "failed" }));
  });

  it("records a Stripe failure without leaking the key", async () => {
    const { d, create, finish } = deps();
    create.mockRejectedValue(new Error("Invalid API Key provided: rk_test_51abcdefgh"));
    const result = await confirmProposal("p1", d);
    expect(result).toMatchObject({ ok: false, code: "stripe_error" });
    expect(JSON.stringify(result)).not.toContain("rk_test_51");
    expect(finish).toHaveBeenCalledWith("p1", expect.objectContaining({ status: "failed" }));
  });
});
