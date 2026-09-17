import { after } from "next/server";
import type Stripe from "stripe";
import { checkAlerts } from "@/lib/alerts/check";
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
  if (inserted.length > 0 && !event.account && shouldCheckAlerts(event.type)) {
    // The endpoint is registered on the demo account only (connected keys cannot register one), so alerts are
    // re-evaluated for the demo account at demo time, after Stripe has its 200.
    after(async () => {
      const demo = await getDemoContext();
      await checkAlerts({ db: getDb(), stripe: createStripeClient(process.env.STRIPE_DEMO_KEY, "STRIPE_DEMO_KEY"), accountId: demo.accountId, now: demo.now, trigger: "webhook" }).catch(
        (error: unknown) => console.error("webhook alert check failed", error),
      );
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
