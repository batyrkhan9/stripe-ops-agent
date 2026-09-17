import "server-only";
import { getDemoContext } from "@/lib/demo/context";
import type { ActiveAccount } from "./account";
import { getActiveAccount } from "./active-account";

export type RequestContext = { account: ActiveAccount; accountId: string; now: number };

// The account a request talks to, the ID its audit and history rows use, and "now": the seed anchor in demo
// mode (ADR 0001), the real time for a connected account.
export async function getRequestContext(): Promise<RequestContext> {
  const account = await getActiveAccount();
  if (account.mode === "demo") {
    const demo = await getDemoContext();
    return { account, accountId: demo.accountId, now: demo.now };
  }
  return {
    account,
    accountId: account.connection.accountId ?? `connection:${account.connection.id}`,
    now: Math.floor(Date.now() / 1000),
  };
}
