import type Stripe from "stripe";

// Reads the agent's read tools need. A key missing any of these is rejected on save.
export const READ_PERMISSIONS = ["charges", "customers", "subscriptions", "invoices", "disputes", "refunds", "balance"] as const;
// Writes behind the confirm step. Each is checked separately; any subset is allowed.
export const WRITE_PERMISSIONS = ["refunds", "coupons", "subscriptions", "disputes"] as const;

export type ReadPermission = (typeof READ_PERMISSIONS)[number];
export type WritePermission = (typeof WRITE_PERMISSIONS)[number];

export type KeyPermissions = {
  read: Record<ReadPermission, boolean>;
  write: Record<WritePermission, boolean>;
  accountId: string | null;
};

export class InvalidKeyError extends Error {}

type Probe = (stripe: Stripe) => Promise<unknown>;

const READ_PROBES: Record<ReadPermission, Probe> = {
  charges: (s) => s.charges.list({ limit: 1 }),
  customers: (s) => s.customers.list({ limit: 1 }),
  subscriptions: (s) => s.subscriptions.list({ limit: 1 }),
  invoices: (s) => s.invoices.list({ limit: 1 }),
  disputes: (s) => s.disputes.list({ limit: 1 }),
  refunds: (s) => s.refunds.list({ limit: 1 }),
  balance: (s) => s.balance.retrieve(),
};

// Write probes never change data. Each targets an object that does not exist or omits a required
// parameter, so a permitted key gets 404 or 400 and a key without the permission gets 403.
// Verified against a full test key and a read-only restricted key on 2026-09-17. Probes where Stripe
// checks the object before the permission (refund create on a missing charge, coupon update) were
// rejected because a read-only key also gets 404 there.
const WRITE_PROBES: Record<WritePermission, Probe> = {
  refunds: (s) => s.refunds.update("re_permission_probe", { metadata: { permission_probe: "1" } }),
  coupons: (s) => s.coupons.create({ duration: "once" }),
  subscriptions: (s) => s.subscriptions.update("sub_permission_probe", { metadata: { permission_probe: "1" } }),
  disputes: (s) => s.disputes.update("du_permission_probe", { submit: false }),
};

function statusOf(error: unknown): number | undefined {
  return (error as { statusCode?: number }).statusCode;
}

async function probe(stripe: Stripe, run: Probe, kind: "read" | "write"): Promise<boolean> {
  try {
    await run(stripe);
    return true;
  } catch (error) {
    const status = statusOf(error);
    if (status === 401) throw new InvalidKeyError("Stripe rejected this key");
    if (status === 403) return false;
    if (kind === "write" && (status === 400 || status === 404)) return true;
    throw error;
  }
}

// One write permission, probed fresh before a confirmed write executes (ADR 0003).
export async function probeWritePermission(stripe: Stripe, permission: WritePermission): Promise<boolean> {
  return probe(stripe, WRITE_PROBES[permission], "write");
}

export async function checkKeyPermissions(stripe: Stripe): Promise<KeyPermissions> {
  const read = {} as Record<ReadPermission, boolean>;
  for (const permission of READ_PERMISSIONS) {
    read[permission] = await probe(stripe, READ_PROBES[permission], "read");
  }
  const write = {} as Record<WritePermission, boolean>;
  for (const permission of WRITE_PERMISSIONS) {
    write[permission] = await probe(stripe, WRITE_PROBES[permission], "write");
  }
  let accountId: string | null = null;
  try {
    accountId = (await stripe.accounts.retrieveCurrent()).id;
  } catch {
    // Most restricted keys cannot read the account. The connection works without the ID.
  }
  return { read, write, accountId };
}

export function missingReads(permissions: KeyPermissions): ReadPermission[] {
  return READ_PERMISSIONS.filter((p) => !permissions.read[p]);
}

export function canWriteAnything(permissions: KeyPermissions): boolean {
  return WRITE_PERMISSIONS.some((p) => permissions.write[p]);
}

export type KeyRejection = "full_secret_key" | "live_key" | "malformed";
export type KeyValidation = { ok: true; key: string } | { ok: false; code: KeyRejection };

// Only restricted test keys. A full secret key would give the app more access than it needs.
export function validatePastedKey(input: string): KeyValidation {
  const key = input.trim();
  if (key.startsWith("sk_test_")) return { ok: false, code: "full_secret_key" };
  if (/^(sk|rk|pk)_live_/.test(key)) return { ok: false, code: "live_key" };
  if (!/^rk_test_[A-Za-z0-9]{20,}$/.test(key)) return { ok: false, code: "malformed" };
  return { ok: true, key };
}
