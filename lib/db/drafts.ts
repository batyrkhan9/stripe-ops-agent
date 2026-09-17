import { and, desc, eq } from "drizzle-orm";
import type { Db } from "./client";
import { drafts } from "./schema";

export type DraftKind = "dispute_evidence" | "recovery_plan";

export async function saveDraft(
  db: Db,
  draft: { accountId: string; kind: DraftKind; targetId: string; content: object; provider?: string; modelId?: string },
) {
  const [row] = await db.insert(drafts).values(draft).returning();
  return row!;
}

export async function latestDraft(db: Db, scope: { accountId: string; kind: DraftKind; targetId: string }) {
  const [row] = await db
    .select()
    .from(drafts)
    .where(and(eq(drafts.accountId, scope.accountId), eq(drafts.kind, scope.kind), eq(drafts.targetId, scope.targetId)))
    .orderBy(desc(drafts.createdAt))
    .limit(1);
  return row;
}
