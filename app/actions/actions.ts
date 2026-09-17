"use server";

import { revalidatePath } from "next/cache";
import { confirmProposal } from "@/lib/actions/confirm";
import { cancelProposal, claimProposal, finishProposal, loadProposal, strictAuditWriter } from "@/lib/actions/store";
import { getDb } from "@/lib/db";
import { probeWritePermission } from "@/lib/stripe/permissions";
import { getRequestContext } from "@/lib/stripe/request-context";

export type ActionFormState = { ok: boolean; message: string } | null;

// Server actions carry Next.js's built-in origin check, which covers CSRF for these forms. Every safety check lives
// in confirmProposal (ADR 0003); this only wires it to the database and the request's account.
export async function confirmAction(_: ActionFormState, formData: FormData): Promise<ActionFormState> {
  const id = String(formData.get("proposal") ?? "");
  const { account, accountId } = await getRequestContext();
  const db = getDb();
  const result = await confirmProposal(id, {
    account:
      account.mode === "demo"
        ? { mode: "demo", accountId }
        : { mode: "connected", accountId, connectionId: account.connection.id, permissions: account.connection.permissions, stripe: account.stripe },
    loadProposal: (proposalId) => loadProposal(db, proposalId),
    claim: (proposalId) => claimProposal(db, proposalId),
    finish: (proposalId, outcome) => finishProposal(db, proposalId, outcome),
    probe: probeWritePermission,
    audit: strictAuditWriter(db, accountId),
  });
  revalidatePath("/actions");
  revalidatePath("/disputes");
  return result.ok ? { ok: true, message: `Done. Stripe object ${result.stripeId} is ${result.status}.` } : { ok: false, message: result.message };
}

export async function cancelAction(_: ActionFormState, formData: FormData): Promise<ActionFormState> {
  const id = String(formData.get("proposal") ?? "");
  const { account, accountId } = await getRequestContext();
  const canceled = await cancelProposal(getDb(), id, { accountId, connectionId: account.connection?.id ?? null });
  revalidatePath("/actions");
  return canceled ? { ok: true, message: "Canceled. Nothing was changed in Stripe." } : { ok: false, message: "This proposal is no longer pending." };
}
