import "server-only";
import { desc, isNotNull } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { seedRuns } from "@/lib/db/schema";

export type DemoContext = { accountId: string; now: number };

let cached: DemoContext | undefined;

// Demo "now" is the anchor of the latest completed seed run (ADR 0001), so time windows never drift.
export async function getDemoContext(): Promise<DemoContext> {
  if (cached) return cached;
  const [run] = await getDb()
    .select({ accountId: seedRuns.accountId, anchorAt: seedRuns.anchorAt })
    .from(seedRuns)
    .where(isNotNull(seedRuns.completedAt))
    .orderBy(desc(seedRuns.completedAt))
    .limit(1);
  cached = run
    ? { accountId: run.accountId, now: Math.floor(run.anchorAt.getTime() / 1000) }
    : { accountId: "demo", now: Math.floor(Date.now() / 1000) };
  return cached;
}
