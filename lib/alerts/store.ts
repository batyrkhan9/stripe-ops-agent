import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { alertEvents } from "@/lib/db/schema";
import type { AlertResult } from "./rules";

export type AlertTrigger = "page_load" | "webhook" | "cron";

// One row per rule per account per day of "now". Re-evaluating the same day updates the row, so the history
// shows when a rule fired without a row for every page view.
export async function recordFiringAlerts(
  db: Db,
  { accountId, now, trigger, results }: { accountId: string; now: number; trigger: AlertTrigger; results: AlertResult[] },
): Promise<void> {
  const firing = results.filter((r) => r.firing && r.severity);
  if (!firing.length) return;
  const dayKey = new Date(now * 1000).toISOString().slice(0, 10);
  for (const result of firing) {
    const values = {
      accountId,
      rule: result.rule,
      dayKey,
      severity: result.severity!,
      value: result.value,
      valueLabel: result.valueLabel,
      summary: result.summary,
      stripeIds: result.stripeIds.slice(0, 100),
      lastTrigger: trigger,
    };
    await db
      .insert(alertEvents)
      .values({ ...values, firstTrigger: trigger })
      .onConflictDoUpdate({
        target: [alertEvents.accountId, alertEvents.rule, alertEvents.dayKey],
        set: { ...values, lastSeenAt: sql`now()`, evaluations: sql`${alertEvents.evaluations} + 1` },
      });
  }
}

export async function alertHistory(db: Db, accountId: string, limit = 50) {
  return db.select().from(alertEvents).where(eq(alertEvents.accountId, accountId)).orderBy(desc(alertEvents.dayKey), desc(alertEvents.lastSeenAt)).limit(limit);
}

export async function lastFired(db: Db, accountId: string, rule: string) {
  const [row] = await db
    .select()
    .from(alertEvents)
    .where(and(eq(alertEvents.accountId, accountId), eq(alertEvents.rule, rule)))
    .orderBy(desc(alertEvents.lastSeenAt))
    .limit(1);
  return row;
}
