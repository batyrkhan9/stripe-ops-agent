// Deterministic seed plan for the demo account. Pure: no Stripe or DB calls.
// All dates are unix seconds, expressed as offsets back from the anchor (ADR 0001).

export const DAY = 86_400;
const HOUR = 3_600;

export type ProductSpec = { seedKey: string; name: string; description: string };

export type PriceSpec = {
  seedKey: string;
  lookupKey: string;
  productKey: string;
  unitAmount: number;
  interval: "month" | "year";
};

export type CustomerSpec = { seedKey: string; name: string; email: string };

export type SubscriptionSpec = {
  seedKey: string;
  customerKey: string;
  priceKey: string;
  target: "active" | "past_due" | "canceled";
  startedAt: number;
  // past_due only: price the subscription is upgraded to when the failing card is charged
  upgradePriceKey?: string;
  failedAt?: number;
  canceledAt?: number;
};

export type PaymentOutcome =
  | "succeeded"
  | "declined_generic"
  | "declined_insufficient_funds"
  | "dispute_fraudulent"
  | "dispute_product_not_received";

export type PaymentSpec = {
  seedKey: string;
  customerKey: string;
  amount: number;
  outcome: PaymentOutcome;
  paymentMethod: string;
  occurredAt: number;
  description: string;
  orderId: string;
  shippingTracking: string;
};

export type RefundSpec = {
  seedKey: string;
  paymentKey: string;
  amount: number;
  occurredAt: number;
  reason: "requested_by_customer" | "duplicate";
};

export type SeedPlan = {
  anchor: number;
  products: ProductSpec[];
  prices: PriceSpec[];
  customers: CustomerSpec[];
  subscriptions: SubscriptionSpec[];
  payments: PaymentSpec[];
  refunds: RefundSpec[];
};

// PaymentMethod tokens verified against docs.stripe.com/testing and a live test-mode run.
export const PAYMENT_METHODS: Record<Exclude<PaymentOutcome, "succeeded">, string> & {
  failOnCharge: string;
} = {
  declined_generic: "pm_card_visa_chargeDeclined",
  declined_insufficient_funds: "pm_card_visa_chargeDeclinedInsufficientFunds",
  dispute_fraudulent: "pm_card_createDispute",
  dispute_product_not_received: "pm_card_createDisputeProductNotReceived",
  failOnCharge: "pm_card_chargeCustomerFail",
};

// Brand and country mix for successful charges. Stripe documents decline cards only for Visa.
const SUCCESS_CARDS: [string, number][] = [
  ["pm_card_visa", 40],
  ["pm_card_mastercard", 20],
  ["pm_card_amex", 10],
  ["pm_card_discover", 5],
  ["pm_card_gb", 7],
  ["pm_card_ca", 6],
  ["pm_card_de", 5],
  ["pm_card_au", 4],
  ["pm_card_br", 3],
];

const PRODUCTS: ProductSpec[] = [
  { seedKey: "product:starter_box", name: "Starter Box", description: "One 250g bag of seasonal coffee each cycle." },
  { seedKey: "product:classic_box", name: "Classic Box", description: "Two 250g bags of single-origin coffee each cycle." },
  { seedKey: "product:deluxe_box", name: "Deluxe Box", description: "Three bags plus a tasting guide each cycle." },
  { seedKey: "product:brew_gear", name: "Brew Gear Add-on", description: "Filters and a rotating brewing accessory." },
  { seedKey: "product:tasting_flight", name: "Tasting Flight", description: "Four 60g sample bags from one region." },
];

const PRICES: PriceSpec[] = [
  { seedKey: "price:starter_monthly", lookupKey: "seed_starter_monthly", productKey: "product:starter_box", unitAmount: 1900, interval: "month" },
  { seedKey: "price:starter_annual", lookupKey: "seed_starter_annual", productKey: "product:starter_box", unitAmount: 19000, interval: "year" },
  { seedKey: "price:classic_monthly", lookupKey: "seed_classic_monthly", productKey: "product:classic_box", unitAmount: 3400, interval: "month" },
  { seedKey: "price:classic_annual", lookupKey: "seed_classic_annual", productKey: "product:classic_box", unitAmount: 34000, interval: "year" },
  { seedKey: "price:deluxe_monthly", lookupKey: "seed_deluxe_monthly", productKey: "product:deluxe_box", unitAmount: 5900, interval: "month" },
  { seedKey: "price:deluxe_annual", lookupKey: "seed_deluxe_annual", productKey: "product:deluxe_box", unitAmount: 59000, interval: "year" },
  { seedKey: "price:brew_gear_monthly", lookupKey: "seed_brew_gear_monthly", productKey: "product:brew_gear", unitAmount: 1200, interval: "month" },
  { seedKey: "price:tasting_flight_monthly", lookupKey: "seed_tasting_flight_monthly", productKey: "product:tasting_flight", unitAmount: 2400, interval: "month" },
];

const NAMES = [
  "Maya Patel", "Liam O'Connor", "Sofia Rossi", "Ethan Nguyen", "Amara Okafor", "Lucas Silva",
  "Hannah Schmidt", "Omar Haddad", "Chloe Martin", "Kenji Tanaka", "Isabel Garcia", "Noah Williams",
  "Priya Sharma", "Mateo Fernandez", "Grace Kim", "Daniel Cohen", "Aisha Bello", "Samuel Johansson",
  "Emily Clarke", "Diego Morales", "Fatima Rahman", "Jack Thompson", "Yuna Park", "Leon Becker",
  "Zara Ahmed", "Owen Davies", "Camila Torres", "Arjun Mehta", "Ella Novak", "Tomas Kowalski",
  "Nadia Petrova", "Ryan Mitchell", "Leila Karimi", "Hugo Dubois", "Mei Chen", "Ben Adeyemi",
  "Olivia Brown", "Rafael Costa", "Ines Moreau", "Victor Lindqvist",
];

const ORDER_ITEMS: [string, number][] = [
  ["Single-origin beans 1kg", 3800],
  ["Pour-over kettle", 6500],
  ["Hand burr grinder", 12900],
  ["Ceramic dripper", 2800],
  ["Gift box", 5400],
  ["Espresso blend 500g", 2200],
  ["Travel mug", 2600],
  ["Cold brew kit", 4400],
];

// mulberry32: small deterministic PRNG so every run produces the same plan.
function createRng(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  return {
    next,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!,
    weighted: (items: [string, number][]) => {
      const total = items.reduce((sum, [, weight]) => sum + weight, 0);
      let roll = next() * total;
      for (const [value, weight] of items) {
        roll -= weight;
        if (roll < 0) return value;
      }
      return items[items.length - 1]![0];
    },
  };
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

export type PlanOptions = { spike?: boolean };

export function buildSeedPlan(anchor: number, options: PlanOptions = {}): SeedPlan {
  const rng = createRng(20260916);
  const at = (offsetSeconds: number) => anchor - offsetSeconds;

  const customers: CustomerSpec[] = NAMES.map((name, i) => ({
    seedKey: `customer:${pad(i + 1)}`,
    name,
    email: `${name.toLowerCase().replace(/[^a-z ]/g, "").replace(" ", ".")}@example.com`,
  }));

  const subscriptions: SubscriptionSpec[] = [];
  const activePrices = PRICES.map((p) => p.seedKey);
  for (let i = 1; i <= 25; i++) {
    subscriptions.push({
      seedKey: `subscription:${pad(i)}`,
      customerKey: `customer:${pad(i)}`,
      priceKey: rng.pick(activePrices),
      target: "active",
      startedAt: at(rng.int(1 * DAY, 88 * DAY)),
    });
  }
  for (let i = 26; i <= 30; i++) {
    subscriptions.push({
      seedKey: `subscription:${pad(i)}`,
      customerKey: `customer:${pad(i)}`,
      priceKey: "price:starter_monthly",
      upgradePriceKey: "price:classic_monthly",
      target: "past_due",
      startedAt: at(rng.int(35 * DAY, 88 * DAY)),
      failedAt: at(rng.int(1 * DAY, 13 * DAY)),
    });
  }
  const monthlyPrices = PRICES.filter((p) => p.interval === "month").map((p) => p.seedKey);
  for (let i = 31; i <= 33; i++) {
    subscriptions.push({
      seedKey: `subscription:${pad(i)}`,
      customerKey: `customer:${pad(i)}`,
      priceKey: rng.pick(monthlyPrices),
      target: "canceled",
      startedAt: at(rng.int(40 * DAY, 88 * DAY)),
      canceledAt: at(rng.int(3 * DAY, 30 * DAY)),
    });
  }

  const payments: PaymentSpec[] = [];
  let orderNumber = 10_001;
  const addPayment = (key: string, outcome: PaymentOutcome, offset: number) => {
    const [item, basePrice] = rng.pick(ORDER_ITEMS);
    const quantity = rng.int(1, 3);
    const tracking = Array.from({ length: 10 }, () => rng.int(0, 9)).join("");
    const payment: PaymentSpec = {
      seedKey: key,
      customerKey: `customer:${pad(rng.int(1, 40))}`,
      amount: basePrice * quantity,
      outcome,
      paymentMethod: outcome === "succeeded" ? rng.weighted(SUCCESS_CARDS) : PAYMENT_METHODS[outcome],
      occurredAt: at(offset),
      description: `Order KC-${orderNumber}: ${quantity}x ${item}`,
      orderId: `KC-${orderNumber}`,
      shippingTracking: `1ZKC${pad(rng.int(0, 99))}${tracking}`,
    };
    orderNumber++;
    payments.push(payment);
    return payment;
  };

  // 317 one-off successes (+33 subscription first charges = 350): 300 in the trailing 30 days, 17 older.
  for (let i = 1; i <= 298; i++) addPayment(`payment:${pad(i, 3)}`, "succeeded", rng.int(HOUR / 2, 29 * DAY + 12 * HOUR));
  addPayment("payment:299", "dispute_fraudulent", 6 * DAY + 7 * HOUR);
  addPayment("payment:300", "dispute_product_not_received", 12 * DAY + 16 * HOUR);
  for (let i = 301; i <= 317; i++) addPayment(`payment:${pad(i, 3)}`, "succeeded", rng.int(31 * DAY, 89 * DAY));

  // 30 declines: 18 in the trailing 7 days so the decline rate alert fires, 12 older.
  for (let i = 1; i <= 30; i++) {
    const outcome = i % 2 === 0 ? "declined_insufficient_funds" : "declined_generic";
    const offset = i <= 18 ? rng.int(HOUR, 6 * DAY + 12 * HOUR) : rng.int(8 * DAY, 85 * DAY);
    addPayment(`decline:${pad(i)}`, outcome, offset);
  }

  if (options.spike) {
    addPayment("spike:dispute:1", "dispute_fraudulent", 1 * DAY + 3 * HOUR);
    addPayment("spike:dispute:2", "dispute_product_not_received", 2 * DAY + 9 * HOUR);
    addPayment("spike:dispute:3", "dispute_fraudulent", 4 * DAY + 20 * HOUR);
  }

  // 6 refunds: 3 in the last 24 hours so the refund spike alert fires, 3 spread out.
  const refundable = payments.filter((p) => p.outcome === "succeeded");
  const refunds: RefundSpec[] = [];
  const refundOffsets = [2 * HOUR, 7 * HOUR, 15 * HOUR, 18 * DAY, 44 * DAY, 71 * DAY];
  refundOffsets.forEach((offset, i) => {
    const refundAt = at(offset);
    const candidates = refundable.filter(
      (p) => p.occurredAt < refundAt - DAY && p.occurredAt > refundAt - 20 * DAY && !refunds.some((r) => r.paymentKey === p.seedKey),
    );
    const payment = rng.pick(candidates);
    refunds.push({
      seedKey: `refund:${i + 1}`,
      paymentKey: payment.seedKey,
      amount: i % 2 === 0 ? payment.amount : Math.round(payment.amount / 2),
      occurredAt: refundAt,
      reason: i === 1 ? "duplicate" : "requested_by_customer",
    });
  });

  return { anchor, products: PRODUCTS, prices: PRICES, customers, subscriptions, payments, refunds };
}

// Idempotency: the seed only creates specs whose seed_key is not already in Stripe.
export function pending<T extends { seedKey: string }>(specs: T[], existingKeys: ReadonlySet<string>): T[] {
  return specs.filter((spec) => !existingKeys.has(spec.seedKey));
}

export function isDispute(outcome: PaymentOutcome): boolean {
  return outcome === "dispute_fraudulent" || outcome === "dispute_product_not_received";
}

export function isDecline(outcome: PaymentOutcome): boolean {
  return outcome === "declined_generic" || outcome === "declined_insufficient_funds";
}
