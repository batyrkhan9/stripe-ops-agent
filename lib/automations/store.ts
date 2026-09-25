import { and, desc, eq, gte, isNull } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { automationRules, automationRuns } from "@/lib/db/schema";
import type { Rule } from "./schema";

export type RuleScope = { accountId: string; connectionId: string | null };

const scoped = (scope: RuleScope) =>
  and(eq(automationRules.accountId, scope.accountId), scope.connectionId ? eq(automationRules.connectionId, scope.connectionId) : isNull(automationRules.connectionId));

export const MAX_RULES = 20;

export async function saveRule(db: Db, scope: RuleScope, entry: { sourceText: string; rule: Rule; readback: string }) {
  const [row] = await db
    .insert(automationRules)
    .values({ accountId: scope.accountId, connectionId: scope.connectionId, name: entry.rule.name, sourceText: entry.sourceText, rule: entry.rule, readback: entry.readback })
    .returning();
  return row!;
}

export async function listRules(db: Db, scope: RuleScope) {
  return db.select().from(automationRules).where(scoped(scope)).orderBy(desc(automationRules.createdAt));
}

export async function enabledRules(db: Db, scope: RuleScope) {
  return db.select().from(automationRules).where(and(scoped(scope), eq(automationRules.enabled, true)));
}

export async function setRuleEnabled(db: Db, scope: RuleScope, id: string, enabled: boolean) {
  const rows = await db.update(automationRules).set({ enabled }).where(and(scoped(scope), eq(automationRules.id, id))).returning({ id: automationRules.id });
  return rows.length === 1;
}

export async function deleteRule(db: Db, scope: RuleScope, id: string) {
  const rows = await db.delete(automationRules).where(and(scoped(scope), eq(automationRules.id, id))).returning({ id: automationRules.id });
  return rows.length === 1;
}

export async function recordRun(db: Db, run: { ruleId: string; accountId: string; trigger: string; eventId: string | null; matched: boolean; outcome: unknown; error?: string }) {
  await db.insert(automationRuns).values({ ...run, outcome: (run.outcome as object) ?? null, error: run.error ?? null });
  await db.update(automationRules).set({ lastRunAt: new Date() }).where(eq(automationRules.id, run.ruleId));
}

export async function listRuns(db: Db, accountId: string, limit = 50) {
  return db
    .select({ run: automationRuns, ruleName: automationRules.name })
    .from(automationRuns)
    .innerJoin(automationRules, eq(automationRuns.ruleId, automationRules.id))
    .where(eq(automationRuns.accountId, accountId))
    .orderBy(desc(automationRuns.createdAt))
    .limit(limit);
}

// Matched runs in the last day whose outcome is a message: brief items for the morning brief, alerts for the pages.
export async function recentRuleMessages(db: Db, accountId: string, type: "brief_item" | "alert", sinceMs = 24 * 60 * 60 * 1000) {
  const rows = await listRunsSince(db, accountId, new Date(Date.now() - sinceMs));
  return rows
    .filter((r) => r.run.matched && (r.run.outcome as { type?: string } | null)?.type === type)
    .map((r) => ({ ruleName: r.ruleName, message: String((r.run.outcome as { message?: string }).message ?? ""), at: r.run.createdAt }));
}

async function listRunsSince(db: Db, accountId: string, since: Date) {
  return db
    .select({ run: automationRuns, ruleName: automationRules.name })
    .from(automationRuns)
    .innerJoin(automationRules, eq(automationRuns.ruleId, automationRules.id))
    .where(and(eq(automationRuns.accountId, accountId), gte(automationRuns.createdAt, since)))
    .orderBy(desc(automationRuns.createdAt))
    .limit(200);
}
