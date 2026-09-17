import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { encryptSecret, signValue } from "@/lib/crypto/secret-box";
import { resolveAccount, type ConnectionRow } from "@/lib/stripe/account";
import type { KeyPermissions } from "@/lib/stripe/permissions";

const env = {
  SESSION_SECRET: "session-secret",
  KEY_ENCRYPTION_SECRET: randomBytes(32).toString("base64"),
  STRIPE_DEMO_KEY: "rk_test_demo" + "d".repeat(30),
};
const merchantKey = "rk_test_merchant" + "m".repeat(30);

const readOnly: KeyPermissions = {
  read: { charges: true, customers: true, subscriptions: true, invoices: true, disputes: true, refunds: true, balance: true },
  write: { refunds: false, coupons: false, subscriptions: false, disputes: false },
  accountId: null,
};

function connection(overrides: Partial<ConnectionRow> = {}): ConnectionRow {
  return {
    id: "conn-1",
    keyCiphertext: encryptSecret(merchantKey, env.KEY_ENCRYPTION_SECRET),
    keyLast4: merchantKey.slice(-4),
    accountId: null,
    permissions: readOnly,
    disconnectedAt: null,
    ...overrides,
  };
}

describe("resolveAccount", () => {
  it("uses the read-only demo account with no cookie", async () => {
    const loadConnection = vi.fn();
    const account = await resolveAccount({ signedCookie: undefined, env, loadConnection });
    expect(account.mode).toBe("demo");
    expect(account.canWrite).toBe(false);
    expect(loadConnection).not.toHaveBeenCalled();
  });

  it("ignores a cookie with a forged signature without touching the database", async () => {
    const loadConnection = vi.fn();
    const forged = signValue("conn-1", "attacker-secret");
    expect((await resolveAccount({ signedCookie: forged, env, loadConnection })).mode).toBe("demo");
    expect(loadConnection).not.toHaveBeenCalled();
  });

  it("falls back to demo for unknown or disconnected connections", async () => {
    const signedCookie = signValue("conn-1", env.SESSION_SECRET);
    expect((await resolveAccount({ signedCookie, env, loadConnection: async () => undefined })).mode).toBe("demo");
    const disconnected = connection({ disconnectedAt: new Date(), keyCiphertext: null });
    expect((await resolveAccount({ signedCookie, env, loadConnection: async () => disconnected })).mode).toBe("demo");
  });

  it("falls back to demo when the stored key cannot be decrypted", async () => {
    const signedCookie = signValue("conn-1", env.SESSION_SECRET);
    const otherSecret = encryptSecret(merchantKey, randomBytes(32).toString("base64"));
    const account = await resolveAccount({ signedCookie, env, loadConnection: async () => connection({ keyCiphertext: otherSecret }) });
    expect(account.mode).toBe("demo");
  });

  it("uses the merchant's key for a valid connection, with write access from its permissions", async () => {
    const signedCookie = signValue("conn-1", env.SESSION_SECRET);
    const readOnlyAccount = await resolveAccount({ signedCookie, env, loadConnection: async () => connection() });
    expect(readOnlyAccount.mode).toBe("connected");
    expect(readOnlyAccount.canWrite).toBe(false);

    const withRefunds = { ...readOnly, write: { ...readOnly.write, refunds: true } };
    const writable = await resolveAccount({ signedCookie, env, loadConnection: async () => connection({ permissions: withRefunds }) });
    expect(writable.canWrite).toBe(true);
  });
});
