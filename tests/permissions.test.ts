import type Stripe from "stripe";
import { describe, expect, it } from "vitest";
import {
  canWriteAnything,
  checkKeyPermissions,
  InvalidKeyError,
  missingReads,
  validatePastedKey,
} from "@/lib/stripe/permissions";

const stripeError = (statusCode: number) => Object.assign(new Error(`status ${statusCode}`), { statusCode });
const ok = async () => ({ id: "x" });

// Builds a fake Stripe client whose read calls and write calls behave as the given status codes.
function fakeStripe(opts: { read: number | "ok"; write: number; readOverrides?: Record<string, number> }) {
  const read = (name: string) => async () => {
    const status = opts.readOverrides?.[name] ?? opts.read;
    if (status === "ok") return ok();
    throw stripeError(status);
  };
  const write = async () => {
    throw stripeError(opts.write);
  };
  return {
    charges: { list: read("charges") },
    customers: { list: read("customers") },
    subscriptions: { list: read("subscriptions"), update: write },
    invoices: { list: read("invoices") },
    disputes: { list: read("disputes"), update: write },
    refunds: { list: read("refunds"), update: write },
    balance: { retrieve: read("balance") },
    coupons: { create: write },
    accounts: { retrieveCurrent: async () => { throw stripeError(403); } },
  } as unknown as Stripe;
}

describe("checkKeyPermissions", () => {
  it("reports a read-only key: every read allowed, every write refused", async () => {
    const permissions = await checkKeyPermissions(fakeStripe({ read: "ok", write: 403 }));
    expect(Object.values(permissions.read).every(Boolean)).toBe(true);
    expect(Object.values(permissions.write).some(Boolean)).toBe(false);
    expect(canWriteAnything(permissions)).toBe(false);
    expect(permissions.accountId).toBeNull();
  });

  it("treats 404 and 400 on write probes as permitted", async () => {
    expect(canWriteAnything(await checkKeyPermissions(fakeStripe({ read: "ok", write: 404 })))).toBe(true);
    expect(canWriteAnything(await checkKeyPermissions(fakeStripe({ read: "ok", write: 400 })))).toBe(true);
  });

  it("lists missing reads", async () => {
    const permissions = await checkKeyPermissions(
      fakeStripe({ read: "ok", write: 403, readOverrides: { disputes: 403, balance: 403 } }),
    );
    expect(missingReads(permissions)).toEqual(["disputes", "balance"]);
  });

  it("throws InvalidKeyError when Stripe rejects the key", async () => {
    await expect(checkKeyPermissions(fakeStripe({ read: 401, write: 401 }))).rejects.toBeInstanceOf(InvalidKeyError);
  });

  it("does not guess on unexpected errors", async () => {
    await expect(checkKeyPermissions(fakeStripe({ read: 500, write: 403 }))).rejects.toThrow("status 500");
    await expect(checkKeyPermissions(fakeStripe({ read: "ok", write: 500 }))).rejects.toThrow("status 500");
  });
});

describe("validatePastedKey", () => {
  const restricted = "rk_test_" + "A1b2".repeat(10);

  it("accepts a restricted test key and trims whitespace", () => {
    expect(validatePastedKey(`  ${restricted}\n`)).toEqual({ ok: true, key: restricted });
  });

  it("refuses a full secret key", () => {
    expect(validatePastedKey("sk_test_" + "a".repeat(40))).toEqual({ ok: false, code: "full_secret_key" });
  });

  it("refuses live keys", () => {
    for (const prefix of ["sk_", "rk_", "pk_"]) {
      expect(validatePastedKey(prefix + "live_" + "a".repeat(40))).toEqual({ ok: false, code: "live_key" });
    }
  });

  it("refuses anything else", () => {
    for (const input of ["", "hello", "pk_test_" + "a".repeat(40), "rk_test_short", restricted + " extra"]) {
      expect(validatePastedKey(input)).toEqual({ ok: false, code: "malformed" });
    }
  });
});
