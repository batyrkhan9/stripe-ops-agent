import "server-only";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { getDb } from "@/lib/db";
import { connections } from "@/lib/db/schema";
import { CONNECTION_COOKIE, resolveAccount, type ActiveAccount } from "./account";

export async function getActiveAccount(): Promise<ActiveAccount> {
  const cookieStore = await cookies();
  return resolveAccount({
    signedCookie: cookieStore.get(CONNECTION_COOKIE)?.value,
    env: {
      SESSION_SECRET: process.env.SESSION_SECRET,
      KEY_ENCRYPTION_SECRET: process.env.KEY_ENCRYPTION_SECRET,
      STRIPE_DEMO_KEY: process.env.STRIPE_DEMO_KEY,
    },
    loadConnection: async (id) => {
      const [row] = await getDb().select().from(connections).where(eq(connections.id, id)).limit(1);
      return row;
    },
  });
}
