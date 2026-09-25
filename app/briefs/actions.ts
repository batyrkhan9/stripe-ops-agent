"use server";

import { revalidatePath } from "next/cache";
import { dayKeyFor } from "@/lib/brief/build";
import { runBrief } from "@/lib/brief/run";
import { briefForDay } from "@/lib/brief/store";
import { getDb } from "@/lib/db";
import { getRequestContext } from "@/lib/stripe/request-context";

export type BriefFormState = { ok: boolean; message: string } | null;

const DEMO_REBUILD_MS = 60 * 60 * 1000;

export async function buildBriefAction(): Promise<BriefFormState> {
  const { account, accountId, now } = await getRequestContext();
  const db = getDb();
  const today = new Date();
  if (account.mode === "demo") {
    const existing = await briefForDay(db, accountId, dayKeyFor(today));
    if (existing && Date.now() - existing.createdAt.getTime() < DEMO_REBUILD_MS) {
      return { ok: true, message: "Today's brief is already built. The demo rebuilds it at most once an hour." };
    }
  }
  try {
    const result = await runBrief({ db, stripe: account.stripe, accountId, now, date: today, trigger: "page", items: [], email: false });
    revalidatePath("/briefs");
    return { ok: true, message: result.brief.summary ? "Built." : "Built without the AI summary; the model providers are busy." };
  } catch {
    return { ok: false, message: "Could not build the brief. Try again in a minute." };
  }
}
