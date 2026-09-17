import type Stripe from "stripe";
import { getDb } from "@/lib/db";
import { stripeEvents } from "@/lib/db/schema";
import { handleWebhook } from "@/lib/stripe/webhook";

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
