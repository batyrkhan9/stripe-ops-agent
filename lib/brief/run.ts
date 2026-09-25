import type Stripe from "stripe";
import type { Db } from "@/lib/db/client";
import { agentModel, finishModel } from "@/lib/llm/provider";
import { buildBrief, type Brief } from "./build";
import { sendBriefEmail, type EmailResult } from "./email";
import { recordBriefEmail, saveBrief } from "./store";
import { summarizeBrief } from "./summary";

export type BriefRunResult = { id: string; brief: Brief; summaryModel: string | null; email: EmailResult | null };

// Builds, summarizes, stores, and (from the cron) emails one brief. The summary is best effort: if every model is
// rate limited the brief is still stored without it, because the facts are the brief.
export async function runBrief({
  db,
  stripe,
  accountId,
  now,
  date,
  trigger,
  items,
  email,
}: {
  db: Db;
  stripe: Stripe;
  accountId: string;
  now: number;
  date: Date;
  trigger: "cron" | "page";
  items: Brief["items"];
  email: boolean;
}): Promise<BriefRunResult> {
  const brief = await buildBrief({ db, stripe, accountId, now, date, items });
  let summaryModel: string | null = null;
  try {
    const summary = await summarizeBrief(brief, [agentModel, finishModel]);
    brief.summary = { text: summary.text, unverified: summary.unverified };
    summaryModel = summary.served?.modelId ?? null;
  } catch (error) {
    console.error("brief summary skipped", error instanceof Error ? error.message.slice(0, 120) : error);
  }
  const row = await saveBrief(db, { accountId, brief, trigger, summaryModel });
  let emailResult: EmailResult | null = null;
  if (email) {
    emailResult = await sendBriefEmail(brief, {
      RESEND_API_KEY: process.env.RESEND_API_KEY,
      BRIEF_FROM_EMAIL: process.env.BRIEF_FROM_EMAIL,
      BRIEF_TO_EMAIL: process.env.BRIEF_TO_EMAIL,
      APP_URL: process.env.APP_URL,
    }).catch((error: unknown) => ({ sent: false as const, reason: error instanceof Error ? error.message.slice(0, 200) : String(error) }));
    await recordBriefEmail(db, row.id, emailResult);
  }
  return { id: row.id, brief, summaryModel, email: emailResult };
}
