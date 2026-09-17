import type Stripe from "stripe";
import {
  isDecline,
  isDispute,
  PAYMENT_METHODS,
  pending,
  type PaymentSpec,
  type SeedPlan,
  type SubscriptionSpec,
} from "./plan";

export type SeededRecord = {
  stripeId: string;
  kind: "created" | "failed" | "canceled";
  objectType: string;
  seedKey: string;
  occurredAt: number;
};

type Log = (message: string) => void;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Stripe's SDK does not retry 429s. Back off and retry; creates also carry idempotency keys.
async function retry<T>(call: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call();
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status !== 429 || attempt >= 6) throw error;
      await sleep(500 * 2 ** attempt + Math.random() * 250);
    }
  }
}

const idempotency = (anchor: number, seedKey: string, step = "create") => ({
  idempotencyKey: `seed:${anchor}:${seedKey}:${step}`,
});

function seedMetadata(seedKey: string, occurredAt: number, extra: Record<string, string> = {}) {
  return { seed: "true", seed_key: seedKey, seed_occurred_at: String(occurredAt), ...extra };
}

async function inPool<T>(items: T[], concurrency: number, work: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
        await work(item);
      }
    }),
  );
}

function bySeedKey<T extends { metadata: Stripe.Metadata | null }>(objects: T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const object of objects) {
    const key = object.metadata?.seed_key;
    if (object.metadata?.seed === "true" && key) map.set(key, object);
  }
  return map;
}

// Reads the anchor from a previous run so re-runs keep the same demo "now".
export async function findExistingAnchor(stripe: Stripe): Promise<number | undefined> {
  for await (const customer of stripe.customers.list({ limit: 100 })) {
    const anchor = customer.metadata?.seed_anchor;
    if (customer.metadata?.seed === "true" && anchor) return Number(anchor);
  }
  return undefined;
}

export async function runSeed(stripe: Stripe, plan: SeedPlan, log: Log): Promise<SeededRecord[]> {
  const records: SeededRecord[] = [];
  const record = (r: SeededRecord) => records.push(r);

  // Products and prices
  const products = bySeedKey(await stripe.products.list({ limit: 100 }).autoPagingToArray({ limit: 1000 }));
  for (const spec of pending(plan.products, new Set(products.keys()))) {
    products.set(
      spec.seedKey,
      await retry(() =>
        stripe.products.create(
          { name: spec.name, description: spec.description, metadata: seedMetadata(spec.seedKey, plan.anchor) },
          idempotency(plan.anchor, spec.seedKey),
        ),
      ),
    );
  }
  const prices = bySeedKey(
    (await stripe.prices.list({ lookup_keys: plan.prices.map((p) => p.lookupKey), limit: 100 })).data,
  );
  for (const spec of pending(plan.prices, new Set(prices.keys()))) {
    prices.set(
      spec.seedKey,
      await retry(() =>
        stripe.prices.create(
          {
            product: products.get(spec.productKey)!.id,
            currency: "usd",
            unit_amount: spec.unitAmount,
            recurring: { interval: spec.interval },
            lookup_key: spec.lookupKey,
            metadata: seedMetadata(spec.seedKey, plan.anchor),
          },
          idempotency(plan.anchor, spec.seedKey),
        ),
      ),
    );
  }
  log(`products ${products.size}, prices ${prices.size}`);

  // Customers
  const customers = bySeedKey(await stripe.customers.list({ limit: 100 }).autoPagingToArray({ limit: 1000 }));
  await inPool(pending(plan.customers, new Set(customers.keys())), 8, async (spec) => {
    customers.set(
      spec.seedKey,
      await retry(() =>
        stripe.customers.create(
          {
            name: spec.name,
            email: spec.email,
            metadata: seedMetadata(spec.seedKey, plan.anchor, { seed_anchor: String(plan.anchor) }),
          },
          idempotency(plan.anchor, spec.seedKey),
        ),
      ),
    );
  });
  for (const [seedKey, customer] of customers) {
    record({ stripeId: customer.id, kind: "created", objectType: "customer", seedKey, occurredAt: plan.anchor });
  }
  log(`customers ${customers.size}`);

  // Subscriptions: every run moves each one toward its target state, so partial runs recover.
  const subscriptions = bySeedKey(
    await stripe.subscriptions.list({ status: "all", limit: 100 }).autoPagingToArray({ limit: 1000 }),
  );
  await inPool(plan.subscriptions, 4, async (spec) => {
    const customer = customers.get(spec.customerKey)!;
    const subscription = await ensureSubscription(stripe, plan.anchor, spec, customer, subscriptions.get(spec.seedKey), prices);
    record({ stripeId: subscription.id, kind: "created", objectType: "subscription", seedKey: spec.seedKey, occurredAt: spec.startedAt });
    if (spec.failedAt) record({ stripeId: subscription.id, kind: "failed", objectType: "subscription", seedKey: spec.seedKey, occurredAt: spec.failedAt });
    if (spec.canceledAt) record({ stripeId: subscription.id, kind: "canceled", objectType: "subscription", seedKey: spec.seedKey, occurredAt: spec.canceledAt });
    for (const charge of await tagSubscriptionCharges(stripe, spec, customer.id)) {
      record({ stripeId: charge.id, kind: "created", objectType: "charge", seedKey: charge.metadata.seed_key!, occurredAt: Number(charge.metadata.seed_occurred_at) });
    }
  });
  log(`subscriptions ${plan.subscriptions.length}`);

  // One-off payments, declines, and disputes
  const intents = bySeedKey(await stripe.paymentIntents.list({ limit: 100 }).autoPagingToArray({ limit: 5000 }));
  const charges = new Map(
    (await stripe.charges.list({ limit: 100 }).autoPagingToArray({ limit: 5000 })).map((c) => [c.id, c]),
  );
  const payments = new Map(plan.payments.map((p) => [p.seedKey, p]));
  await inPool(plan.payments, 6, async (spec) => {
    const intent =
      intents.get(spec.seedKey) ?? (await createPayment(stripe, plan.anchor, spec, customers.get(spec.customerKey)!.id));
    intents.set(spec.seedKey, intent);
    record({ stripeId: intent.id, kind: "created", objectType: "payment_intent", seedKey: spec.seedKey, occurredAt: spec.occurredAt });
    const chargeId = typeof intent.latest_charge === "string" ? intent.latest_charge : intent.latest_charge?.id;
    if (!chargeId) throw new Error(`${spec.seedKey}: payment intent ${intent.id} has no charge`);
    if (charges.get(chargeId)?.metadata.seed_key !== spec.seedKey) {
      await retry(() => stripe.charges.update(chargeId, { metadata: paymentMetadata(spec) }));
    }
    record({ stripeId: chargeId, kind: "created", objectType: "charge", seedKey: spec.seedKey, occurredAt: spec.occurredAt });
    if (isDispute(spec.outcome)) {
      const dispute = await waitForDispute(stripe, chargeId, spec.seedKey);
      if (dispute.metadata?.seed_key !== spec.seedKey) {
        // submit: false, otherwise Stripe submits empty evidence to the bank.
        await retry(() =>
          stripe.disputes.update(dispute.id, { metadata: seedMetadata(spec.seedKey, spec.occurredAt), submit: false }),
        );
      }
      record({ stripeId: dispute.id, kind: "created", objectType: "dispute", seedKey: spec.seedKey, occurredAt: spec.occurredAt });
    }
  });
  log(`payments ${plan.payments.length}`);

  // Refunds
  const refunds = bySeedKey(await stripe.refunds.list({ limit: 100 }).autoPagingToArray({ limit: 1000 }));
  for (const spec of plan.refunds) {
    const payment = payments.get(spec.paymentKey)!;
    const intent = intents.get(spec.paymentKey)!;
    const refund =
      refunds.get(spec.seedKey) ??
      (await retry(() =>
        stripe.refunds.create(
          {
            payment_intent: intent.id,
            amount: spec.amount,
            reason: spec.reason,
            metadata: seedMetadata(spec.seedKey, spec.occurredAt, { order_id: payment.orderId }),
          },
          idempotency(plan.anchor, spec.seedKey),
        ),
      ));
    record({ stripeId: refund.id, kind: "created", objectType: "refund", seedKey: spec.seedKey, occurredAt: spec.occurredAt });
  }
  log(`refunds ${plan.refunds.length}`);

  return records;
}

function paymentMetadata(spec: PaymentSpec) {
  return seedMetadata(spec.seedKey, spec.occurredAt, {
    order_id: spec.orderId,
    shipping_tracking: spec.shippingTracking,
  });
}

async function createPayment(
  stripe: Stripe,
  anchor: number,
  spec: PaymentSpec,
  customerId: string,
): Promise<Stripe.PaymentIntent> {
  const params: Stripe.PaymentIntentCreateParams = {
    amount: spec.amount,
    currency: "usd",
    customer: customerId,
    description: spec.description,
    payment_method: spec.paymentMethod,
    payment_method_types: ["card"],
    confirm: true,
    metadata: paymentMetadata(spec),
  };
  try {
    return await retry(() => stripe.paymentIntents.create(params, idempotency(anchor, spec.seedKey)));
  } catch (error) {
    // Declines throw, but the payment intent and its failed charge still exist.
    const intent = (error as { payment_intent?: Stripe.PaymentIntent }).payment_intent;
    if (isDecline(spec.outcome) && intent) return intent;
    throw error;
  }
}

async function waitForDispute(stripe: Stripe, chargeId: string, seedKey: string): Promise<Stripe.Dispute> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const { data } = await retry(() => stripe.disputes.list({ charge: chargeId, limit: 1 }));
    if (data[0]) return data[0];
    await sleep(2000);
  }
  throw new Error(`${seedKey}: no dispute appeared on ${chargeId} after 60s`);
}

async function ensureSubscription(
  stripe: Stripe,
  anchor: number,
  spec: SubscriptionSpec,
  customer: Stripe.Customer,
  existing: Stripe.Subscription | undefined,
  prices: Map<string, Stripe.Price>,
): Promise<Stripe.Subscription> {
  let subscription = existing;
  if (!subscription) {
    const card = await retry(() =>
      stripe.paymentMethods.attach("pm_card_visa", { customer: customer.id }, idempotency(anchor, spec.seedKey, "card")),
    );
    subscription = await retry(() =>
      stripe.subscriptions.create(
        {
          customer: customer.id,
          items: [{ price: prices.get(spec.priceKey)!.id }],
          default_payment_method: card.id,
          metadata: seedMetadata(spec.seedKey, spec.startedAt, {
            ...(spec.failedAt ? { seed_failed_at: String(spec.failedAt) } : {}),
            ...(spec.canceledAt ? { seed_canceled_at: String(spec.canceledAt) } : {}),
          }),
        },
        idempotency(anchor, spec.seedKey),
      ),
    );
  }

  if (spec.target === "past_due" && subscription.status === "active") {
    // Verified in test mode: upgrading with always_invoice while the default card fails on charge
    // leaves the subscription past_due with an open invoice.
    const current = subscription;
    const failing = await retry(() =>
      stripe.paymentMethods.attach(PAYMENT_METHODS.failOnCharge, { customer: customer.id }),
    );
    const previous = current.default_payment_method;
    await retry(() => stripe.subscriptions.update(current.id, { default_payment_method: failing.id }));
    if (typeof previous === "string") await retry(() => stripe.paymentMethods.detach(previous));
    try {
      subscription = await retry(() =>
        stripe.subscriptions.update(current.id, {
          items: [{ id: current.items.data[0]!.id, price: prices.get(spec.upgradePriceKey!)!.id }],
          proration_behavior: "always_invoice",
          payment_behavior: "allow_incomplete",
        }),
      );
    } catch {
      subscription = await retry(() => stripe.subscriptions.retrieve(current.id));
    }
  }

  if (spec.target === "canceled" && subscription.status !== "canceled") {
    const id = subscription.id;
    subscription = await retry(() => stripe.subscriptions.cancel(id));
  }

  if (subscription.status !== spec.target) {
    throw new Error(`${spec.seedKey}: expected ${spec.target}, got ${subscription.status}`);
  }
  return subscription;
}

// Subscription invoices create their own charges. Tag them so they carry intended dates too.
async function tagSubscriptionCharges(stripe: Stripe, spec: SubscriptionSpec, customerId: string) {
  const charges = await retry(() =>
    stripe.charges.list({ customer: customerId, limit: 100 }).autoPagingToArray({ limit: 1000 }),
  );
  const tagged: Stripe.Charge[] = [];
  for (const charge of charges) {
    // Skip one-off order charges for the same customer, tagged or not.
    if (charge.description?.startsWith("Order KC-")) continue;
    if (charge.metadata.seed_key && !charge.metadata.seed_key.startsWith(`${spec.seedKey}:`)) continue;
    const isFailure = charge.status === "failed";
    const seedKey = `${spec.seedKey}:${isFailure ? "failed_charge" : "first_charge"}`;
    const occurredAt = isFailure ? spec.failedAt ?? spec.startedAt : spec.startedAt;
    if (charge.metadata.seed_key !== seedKey) {
      tagged.push(await retry(() => stripe.charges.update(charge.id, { metadata: seedMetadata(seedKey, occurredAt) })));
    } else {
      tagged.push(charge);
    }
  }
  return tagged;
}
