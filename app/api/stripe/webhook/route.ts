import { after } from "next/server";
import type Stripe from "stripe";
import { checkAlerts } from "@/lib/alerts/check";
import { eventContext } from "@/lib/automations/context";
import { runRules } from "@/lib/automations/executor";
import { enabledRules } from "@/lib/automations/store";
import { getDb } from "@/lib/db";
import { stripeEvents } from "@/lib/db/schema";
import { getDemoContext } from "@/lib/demo/context";
import { createStripeClient } from "@/lib/stripe/client";
import { handleWebhook, shouldCheckAlerts } from "@/lib/stripe/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function storeEvent(event: Stripe.Event) {
  const inserted = await getDb()
    .insert(stripeEvents)
    .values({
      id: event.id,
      type: event.type,
      accountId: event.account ?? null,
      createdAt: new Date(event.created * 1000),
      payload: event,
    })
    .onConflictDoNothing()
    .returning({ id: stripeEvents.id });
  if (inserted.length > 0 && !event.account) {
    // The endpoint is registered on the demo account only (connected keys cannot register one), so alerts and
    // event rules run for the demo account at demo time, after Stripe has its 200.
    after(async () => {
      const demo = await getDemoContext();
      const db = getDb();
      const stripe = createStripeClient(process.env.STRIPE_DEMO_KEY, "STRIPE_DEMO_KEY");
      if (shouldCheckAlerts(event.type)) {
        await checkAlerts({ db, stripe, accountId: demo.accountId, now: demo.now, trigger: "webhook" }).catch((error: unknown) => console.error("webhook alert check failed", error));
      }
      const ctx = eventContext(event);
      if (ctx) {
        const scope = { accountId: demo.accountId, connectionId: null };
        const rules = (await enabledRules(db, scope)).filter((r) => (r.rule as { trigger: { type: string; event?: string } }).trigger.event === event.type);
        if (rules.length) {
          await runRules(rules, ctx, { db, stripe, accountId: demo.accountId, mode: "demo", connectionId: null, permissions: null, now: demo.now }, scope, "webhook").catch((error: unknown) =>
            console.error("webhook rules failed", error),
          );
        }
      }
    });
  }
  return inserted.length > 0 ? "stored" : "duplicate";
}

export async function POST(request: Request) {
  const result = await handleWebhook(
    {
      // Signature verification needs the raw body, so read text, not JSON.
      payload: await request.text(),
      signature: request.headers.get("stripe-signature"),
      secret: process.env.STRIPE_WEBHOOK_SECRET,
    },
    storeEvent,
  );
  return Response.json(result.body, { status: result.status });
}
