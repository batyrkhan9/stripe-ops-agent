"use server";

import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Stripe from "stripe";
import { encryptSecret, signValue, verifySignedValue } from "@/lib/crypto/secret-box";
import { getDb } from "@/lib/db";
import { connections } from "@/lib/db/schema";
import { CONNECTION_COOKIE } from "@/lib/stripe/account";
import { checkKeyPermissions, InvalidKeyError, missingReads, validatePastedKey, type KeyPermissions } from "@/lib/stripe/permissions";

const THIRTY_DAYS = 60 * 60 * 24 * 30;

// Server actions carry Next.js's built-in origin check, which covers CSRF for these forms.
export async function connectKey(formData: FormData) {
  const validation = validatePastedKey(String(formData.get("key") ?? ""));
  if (!validation.ok) redirect(`/settings?error=${validation.code}`);

  let permissions: KeyPermissions;
  try {
    permissions = await checkKeyPermissions(new Stripe(validation.key, { maxNetworkRetries: 2 }));
  } catch (error) {
    redirect(`/settings?error=${error instanceof InvalidKeyError ? "rejected_by_stripe" : "stripe_unreachable"}`);
  }

  const missing = missingReads(permissions);
  if (missing.length > 0) redirect(`/settings?error=missing_reads&missing=${missing.join(",")}`);

  const [row] = await getDb()
    .insert(connections)
    .values({
      keyCiphertext: encryptSecret(validation.key, process.env.KEY_ENCRYPTION_SECRET),
      keyLast4: validation.key.slice(-4),
      accountId: permissions.accountId,
      permissions,
      checkedAt: new Date(),
    })
    .returning({ id: connections.id });

  (await cookies()).set(CONNECTION_COOKIE, signValue(row!.id, process.env.SESSION_SECRET), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: THIRTY_DAYS,
  });
  redirect("/settings?connected=1");
}

export async function disconnectKey() {
  const cookieStore = await cookies();
  const connectionId = verifySignedValue(cookieStore.get(CONNECTION_COOKIE)?.value, process.env.SESSION_SECRET);
  if (connectionId) {
    await getDb()
      .update(connections)
      .set({ keyCiphertext: null, disconnectedAt: new Date() })
      .where(eq(connections.id, connectionId));
  }
  cookieStore.delete(CONNECTION_COOKIE);
  redirect("/settings");
}
