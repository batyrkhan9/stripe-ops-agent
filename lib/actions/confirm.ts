import type Stripe from "stripe";
import type { KeyPermissions, WritePermission } from "@/lib/stripe/permissions";
import { redactSecrets } from "@/lib/tools/format";
import type { AuditRecord } from "@/lib/tools/types";
import { isWriteToolName, WRITE_TOOLS } from "@/lib/tools/write";

export type StoredProposal = {
  id: string;
  accountId: string;
  connectionId: string | null;
  tool: string;
  permission: string;
  params: unknown;
  status: string;
  targetIds: string[];
};

export type ConfirmDeps = {
  account:
    | { mode: "demo"; accountId: string }
    | { mode: "connected"; accountId: string; connectionId: string; permissions: KeyPermissions; stripe: Stripe };
  loadProposal: (id: string) => Promise<StoredProposal | undefined>;
  // Atomically moves proposed -> executing. Returns false if another request already did.
  claim: (id: string) => Promise<boolean>;
  finish: (id: string, outcome: { status: "executed" | "failed"; result?: unknown; error?: string }) => Promise<void>;
  probe: (stripe: Stripe, permission: WritePermission) => Promise<boolean>;
  // Must throw if the row is not written: a write that cannot be audited does not run.
  audit: (record: AuditRecord) => Promise<void>;
};

export type ConfirmResult =
  | { ok: true; stripeId: string; status: string }
  | { ok: false; code: "not_found" | "not_pending" | "demo" | "wrong_account" | "no_permission" | "permission_revoked" | "invalid" | "stripe_error" | "audit_failed"; message: string };

const refuse = (code: Extract<ConfirmResult, { ok: false }>["code"], message: string): ConfirmResult => ({ ok: false, code, message });

// The only path that changes Stripe data (ADR 0003). Every check runs on the server at confirm time: the proposal
// belongs to this account and connection, is still pending, the stored permission allows it, and a fresh probe of
// the key still agrees. The Stripe call uses the proposal ID as its idempotency key.
export async function confirmProposal(id: string, deps: ConfirmDeps): Promise<ConfirmResult> {
  const proposal = await deps.loadProposal(id);
  if (!proposal) return refuse("not_found", "This proposal does not exist.");
  if (deps.account.mode === "demo") {
    await deps.audit({ agent: "confirm", tool: proposal.tool, params: { proposal_id: id }, stripeIds: proposal.targetIds, result: { refused: "demo" } });
    return refuse("demo", "The demo account is read-only. Connect a test key with write access in Settings to confirm actions.");
  }
  const { account } = deps;
  if (proposal.accountId !== account.accountId || proposal.connectionId !== account.connectionId) {
    return refuse("wrong_account", "This proposal was made for a different connection.");
  }
  if (proposal.status !== "proposed") return refuse("not_pending", `This proposal is already ${proposal.status}.`);
  if (!isWriteToolName(proposal.tool)) return refuse("invalid", "Unknown action.");
  const definition = WRITE_TOOLS[proposal.tool];
  const permission = definition.permission;
  if (!account.permissions.write[permission]) {
    await deps.audit({ agent: "confirm", tool: proposal.tool, params: { proposal_id: id }, stripeIds: proposal.targetIds, result: { refused: "no_permission" } });
    return refuse("no_permission", `The connected key cannot write ${permission}.`);
  }
  if (!(await deps.probe(account.stripe, permission).catch(() => false))) {
    await deps.audit({ agent: "confirm", tool: proposal.tool, params: { proposal_id: id }, stripeIds: proposal.targetIds, result: { refused: "permission_revoked" } });
    return refuse("permission_revoked", `Stripe says the key can no longer write ${permission}. Reconnect in Settings.`);
  }
  const parsed = definition.input.safeParse(proposal.params);
  if (!parsed.success) return refuse("invalid", "The stored proposal is no longer valid.");

  if (!(await deps.claim(id))) return refuse("not_pending", "This proposal is already being confirmed.");
  try {
    await deps.audit({ agent: "confirm", tool: proposal.tool, params: proposal.params, stripeIds: proposal.targetIds, result: { executing: id } });
  } catch {
    await deps.finish(id, { status: "failed", error: "audit log write failed, action not executed" });
    return refuse("audit_failed", "The action was not run because it could not be recorded in the audit log.");
  }

  try {
    const result = await (definition.execute as (input: unknown, ctx: { stripe: Stripe; idempotencyKey: string }) => Promise<{ id: string; status: string }>)(
      parsed.data,
      { stripe: account.stripe, idempotencyKey: `proposal:${id}` },
    );
    await deps.finish(id, { status: "executed", result });
    await deps.audit({ agent: "confirm", tool: proposal.tool, params: proposal.params, stripeIds: [...new Set([...proposal.targetIds, result.id])], result }).catch(() => undefined);
    return { ok: true, stripeId: result.id, status: result.status };
  } catch (error) {
    const message = redactSecrets(error instanceof Error ? error.message : String(error));
    await deps.finish(id, { status: "failed", error: message });
    await deps.audit({ agent: "confirm", tool: proposal.tool, params: proposal.params, stripeIds: proposal.targetIds, result: { error: message } }).catch(() => undefined);
    return refuse("stripe_error", `Stripe refused the action: ${message}`);
  }
}
