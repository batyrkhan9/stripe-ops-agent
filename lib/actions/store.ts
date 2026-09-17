import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { auditLog, proposedActions } from "@/lib/db/schema";
import type { AuditRecord } from "@/lib/tools/types";
import type { StoredProposal } from "./confirm";
import type { NewProposal } from "./propose";

export async function saveProposal(db: Db, proposal: NewProposal): Promise<string> {
  const [row] = await db
    .insert(proposedActions)
    .values({
      accountId: proposal.accountId,
      connectionId: proposal.connectionId,
      mode: proposal.mode,
      agent: proposal.agent,
      tool: proposal.tool,
      permission: proposal.permission,
      params: proposal.params as object,
      summary: proposal.summary,
      details: proposal.details,
      confirmLabel: proposal.confirmLabel,
      targetIds: proposal.targetIds,
    })
    .returning({ id: proposedActions.id });
  return row!.id;
}

export async function loadProposal(db: Db, id: string): Promise<StoredProposal | undefined> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
  const [row] = await db.select().from(proposedActions).where(eq(proposedActions.id, id)).limit(1);
  return row;
}

export async function claimProposal(db: Db, id: string): Promise<boolean> {
  const rows = await db
    .update(proposedActions)
    .set({ status: "executing" })
    .where(and(eq(proposedActions.id, id), eq(proposedActions.status, "proposed")))
    .returning({ id: proposedActions.id });
  return rows.length === 1;
}

export async function finishProposal(db: Db, id: string, outcome: { status: "executed" | "failed"; result?: unknown; error?: string }) {
  await db
    .update(proposedActions)
    .set({ status: outcome.status, result: (outcome.result as object) ?? null, error: outcome.error ?? null, decidedAt: sql`now()` })
    .where(eq(proposedActions.id, id));
}

export async function cancelProposal(db: Db, id: string, scope: { accountId: string; connectionId: string | null }): Promise<boolean> {
  const rows = await db
    .update(proposedActions)
    .set({ status: "canceled", decidedAt: sql`now()` })
    .where(
      and(
        eq(proposedActions.id, id),
        eq(proposedActions.status, "proposed"),
        eq(proposedActions.accountId, scope.accountId),
        scope.connectionId ? eq(proposedActions.connectionId, scope.connectionId) : isNull(proposedActions.connectionId),
      ),
    )
    .returning({ id: proposedActions.id });
  return rows.length === 1;
}

// Proposals for this account and connection. Demo proposals have no connection and are shared by demo visitors.
export async function listProposals(db: Db, scope: { accountId: string; connectionId: string | null }, limit = 50) {
  return db
    .select()
    .from(proposedActions)
    .where(
      and(
        eq(proposedActions.accountId, scope.accountId),
        scope.connectionId ? eq(proposedActions.connectionId, scope.connectionId) : isNull(proposedActions.connectionId),
      ),
    )
    .orderBy(desc(proposedActions.createdAt))
    .limit(limit);
}

export async function listAudit(db: Db, accountId: string, { limit = 50, offset = 0 } = {}) {
  return db.select().from(auditLog).where(eq(auditLog.accountId, accountId)).orderBy(desc(auditLog.createdAt)).limit(limit).offset(offset);
}

// For confirmed writes: unlike the best-effort read audit, a failed insert throws so the write does not run.
export function strictAuditWriter(db: Db, accountId: string) {
  return async (record: AuditRecord) => {
    await db.insert(auditLog).values({
      accountId,
      agent: record.agent,
      tool: record.tool,
      params: (record.params as object) ?? {},
      stripeIds: record.stripeIds,
      result: record.result as object,
    });
  };
}
