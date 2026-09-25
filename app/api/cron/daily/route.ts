import { isAuthorizedCron } from "@/lib/brief/cron-auth";
import { runScheduledRules } from "@/lib/automations/schedule";
import { recentRuleMessages } from "@/lib/automations/store";
import { runBrief } from "@/lib/brief/run";
import { getDb } from "@/lib/db";
import { getDemoContext } from "@/lib/demo/context";
import { createStripeClient } from "@/lib/stripe/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Daily Vercel cron (vercel.json). Builds and emails the demo account's brief. Connected accounts have no stored
// email address and their keys cannot be used outside a request that carries their cookie, so their briefs are
// built on demand from /briefs.
export async function GET(request: Request) {
  if (!isAuthorizedCron(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const demo = await getDemoContext();
  const db = getDb();
  const stripe = createStripeClient(process.env.STRIPE_DEMO_KEY, "STRIPE_DEMO_KEY");
  // Daily rules run first so their brief items land in today's brief.
  const scope = { accountId: demo.accountId, connectionId: null };
  const rules = await runScheduledRules({ db, stripe, accountId: demo.accountId, mode: "demo", connectionId: null, permissions: null, now: demo.now }, scope, "cron").catch((error: unknown) => {
    console.error("scheduled rules failed", error);
    return { ran: 0, matched: 0, error: error instanceof Error ? error.message.slice(0, 200) : String(error) };
  });
  const items = await recentRuleMessages(db, demo.accountId, "brief_item");
  const result = await runBrief({ db, stripe, accountId: demo.accountId, now: demo.now, date: new Date(), trigger: "cron", items, email: true });
  return Response.json({
    rules,
    brief: { id: result.id, day: result.brief.dayKey, alerts: result.brief.alerts.length, disputes: result.brief.disputes.length, invoices: result.brief.invoices.length, summary: Boolean(result.brief.summary) },
    email: result.email,
  });
}
