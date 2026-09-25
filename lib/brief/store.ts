import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { briefs } from "@/lib/db/schema";
import type { Brief } from "./build";
import type { EmailResult } from "./email";

export async function saveBrief(db: Db, entry: { accountId: string; brief: Brief; trigger: "cron" | "page"; summaryModel?: string | null }) {
  const values = { accountId: entry.accountId, dayKey: entry.brief.dayKey, content: entry.brief, trigger: entry.trigger, summaryModel: entry.summaryModel ?? null, createdAt: new Date() };
  const [row] = await db
    .insert(briefs)
    .values(values)
    .onConflictDoUpdate({ target: [briefs.accountId, briefs.dayKey], set: values })
    .returning();
  return row!;
}

export async function recordBriefEmail(db: Db, id: string, result: EmailResult) {
  await db
    .update(briefs)
    .set(result.sent ? { emailedTo: result.to, emailedAt: new Date(), emailError: null } : { emailError: result.reason })
    .where(eq(briefs.id, id));
}

export async function listBriefs(db: Db, accountId: string, limit = 30) {
  return db.select().from(briefs).where(eq(briefs.accountId, accountId)).orderBy(desc(briefs.dayKey)).limit(limit);
}

export async function briefForDay(db: Db, accountId: string, dayKey: string) {
  const [row] = await db.select().from(briefs).where(and(eq(briefs.accountId, accountId), eq(briefs.dayKey, dayKey))).limit(1);
  return row;
}
