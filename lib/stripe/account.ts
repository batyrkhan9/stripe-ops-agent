import type Stripe from "stripe";
import { decryptSecret, verifySignedValue } from "@/lib/crypto/secret-box";
import { createStripeClient } from "./client";
import { canWriteAnything, type KeyPermissions } from "./permissions";

export const CONNECTION_COOKIE = "soa_connection";

export type ConnectionRow = {
  id: string;
  keyCiphertext: string | null;
  keyLast4: string;
  accountId: string | null;
  permissions: KeyPermissions;
  disconnectedAt: Date | null;
};

export type ActiveAccount =
  | { mode: "demo"; stripe: Stripe; canWrite: false; connection: null }
  | { mode: "connected"; stripe: Stripe; canWrite: boolean; connection: ConnectionRow };

export type ResolveInput = {
  signedCookie: string | undefined;
  env: { SESSION_SECRET?: string; KEY_ENCRYPTION_SECRET?: string; STRIPE_DEMO_KEY?: string };
  loadConnection: (id: string) => Promise<ConnectionRow | undefined>;
};

// The single place that decides which Stripe account a request talks to. Anything that fails to
// check out (no cookie, bad signature, disconnected, undecryptable) falls back to the read-only demo.
export async function resolveAccount({ signedCookie, env, loadConnection }: ResolveInput): Promise<ActiveAccount> {
  const demo = (): ActiveAccount => ({
    mode: "demo",
    stripe: createStripeClient(env.STRIPE_DEMO_KEY, "STRIPE_DEMO_KEY"),
    canWrite: false,
    connection: null,
  });

  const connectionId = verifySignedValue(signedCookie, env.SESSION_SECRET);
  if (!connectionId) return demo();

  const connection = await loadConnection(connectionId);
  if (!connection || connection.disconnectedAt || !connection.keyCiphertext) return demo();

  let key: string;
  try {
    key = decryptSecret(connection.keyCiphertext, env.KEY_ENCRYPTION_SECRET);
  } catch {
    return demo();
  }
  return {
    mode: "connected",
    stripe: createStripeClient(key, "connection key"),
    canWrite: canWriteAnything(connection.permissions),
    connection,
  };
}
