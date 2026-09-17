// pnpm seed [--spike]
import { config } from "dotenv";
import { eq, sql } from "drizzle-orm";
import { createDb } from "@/lib/db/client";
import { seededObjects, seedRuns } from "@/lib/db/schema";
import { createStripeClient } from "../client";
import { resolveSeedKey } from "../keys";
import { buildSeedPlan } from "./plan";
import { findExistingAnchor, runSeed } from "./run";

config({ path: ".env.local", quiet: true });

async function main() {
  const spike = process.argv.includes("--spike");
  const seedKey = resolveSeedKey({
    STRIPE_SEED_KEY: process.env.STRIPE_SEED_KEY,
    STRIPE_DEMO_KEY: process.env.STRIPE_DEMO_KEY,
  });
  const stripe = createStripeClient(seedKey, "STRIPE_SEED_KEY");
  const db = createDb(process.env.DATABASE_URL);

  const account = await stripe.accounts.retrieveCurrent();
  const existingAnchor = await findExistingAnchor(stripe);
  const anchor = existingAnchor ?? Math.floor(Date.now() / 1000);
  const log = (message: string) => console.log(`[seed] ${message}`);
  log(`account ${account.id}, anchor ${new Date(anchor * 1000).toISOString()} (${existingAnchor ? "reused" : "new"})${spike ? ", spike" : ""}`);

  const [run] = await db
    .insert(seedRuns)
    .values({ accountId: account.id, anchorAt: new Date(anchor * 1000), startedAt: new Date(), spike })
    .returning({ id: seedRuns.id });

  const plan = buildSeedPlan(anchor, { spike });
  const records = await runSeed(stripe, plan, log);

  const rows = records.map((r) => ({
    stripeId: r.stripeId,
    kind: r.kind,
    accountId: account.id,
    objectType: r.objectType,
    seedKey: r.seedKey,
    occurredAt: new Date(r.occurredAt * 1000),
  }));
  for (let i = 0; i < rows.length; i += 200) {
    await db
      .insert(seededObjects)
      .values(rows.slice(i, i + 200))
      .onConflictDoUpdate({
        target: [seededObjects.stripeId, seededObjects.kind],
        set: { occurredAt: sql`excluded.occurred_at`, seedKey: sql`excluded.seed_key` },
      });
  }

  const counts: Record<string, number> = {};
  for (const r of records) counts[`${r.objectType}:${r.kind}`] = (counts[`${r.objectType}:${r.kind}`] ?? 0) + 1;
  await db.update(seedRuns).set({ completedAt: new Date(), counts }).where(eq(seedRuns.id, run!.id));
  log(`done: ${JSON.stringify(counts)}`);
}

main().catch((error: unknown) => {
  console.error(`[seed] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
