// Revenue analytics as pure functions over dated records (spec: Revenue analytics, C018, C019, C060, C047).
// Every function takes "now" so demo numbers stay fixed at the seed anchor (ADR 0001). Amounts are minor units.

export const DAY = 86_400;

export type SubscriptionRecord = {
  id: string;
  customerId: string;
  status: string;
  startedAt: number;
  canceledAt: number | null;
  monthlyAmount: number; // normalized to one month, minor units
  currency: string;
  product: string;
};

export type AnalyticsDataShape = { subscriptions: SubscriptionRecord[]; charges: ChargeRecord[] };

export type ChargeRecord = {
  id: string;
  time: number;
  status: "succeeded" | "failed" | "pending";
  amount: number;
  currency: string;
  brand: string | null;
  country: string | null;
};

// Stripe counts past_due subscriptions in MRR until they are canceled; incomplete ones never started paying.
const NEVER_PAID = new Set(["incomplete", "incomplete_expired"]);

export function monthlyAmount(unitAmount: number, quantity: number, interval: string, intervalCount = 1): number {
  const perInterval = unitAmount * quantity;
  const months = interval === "year" ? 12 * intervalCount : interval === "week" ? (7 * intervalCount) / (365 / 12) : interval === "day" ? intervalCount / (365 / 12) : intervalCount;
  return Math.round(perInterval / months);
}

export function isLiveAt(sub: SubscriptionRecord, at: number): boolean {
  if (NEVER_PAID.has(sub.status)) return false;
  return sub.startedAt <= at && (sub.canceledAt === null || sub.canceledAt > at);
}

export function mrrAt(subs: SubscriptionRecord[], at: number): number {
  return subs.filter((s) => isLiveAt(s, at)).reduce((sum, s) => sum + s.monthlyAmount, 0);
}

export type MrrPoint = { at: number; mrr: number; subscriptions: number };

// Weekly points back from now, oldest first.
export function mrrSeries(subs: SubscriptionRecord[], now: number, weeks = 13): MrrPoint[] {
  return Array.from({ length: weeks }, (_, i) => {
    const at = now - (weeks - 1 - i) * 7 * DAY;
    return { at, mrr: mrrAt(subs, at), subscriptions: subs.filter((s) => isLiveAt(s, at)).length };
  });
}

export type MrrMovement = {
  start: number;
  end: number;
  newMrr: number;
  churnedMrr: number;
  net: number;
  newIds: string[];
  churnedIds: string[];
};

// MRR at the start and end of the window, split into new subscriptions and cancellations. Plan changes are not
// tracked separately: a subscription counts at its current price for its whole life.
export function mrrMovement(subs: SubscriptionRecord[], now: number, days = 30): MrrMovement {
  const from = now - days * DAY;
  const started = subs.filter((s) => !NEVER_PAID.has(s.status) && s.startedAt > from && s.startedAt <= now && isLiveAt(s, now));
  const churned = subs.filter((s) => s.canceledAt !== null && s.canceledAt > from && s.canceledAt <= now && s.startedAt <= from);
  const start = mrrAt(subs, from);
  const end = mrrAt(subs, now);
  return {
    start,
    end,
    newMrr: started.reduce((sum, s) => sum + s.monthlyAmount, 0),
    churnedMrr: churned.reduce((sum, s) => sum + s.monthlyAmount, 0),
    net: end - start,
    newIds: started.map((s) => s.id),
    churnedIds: churned.map((s) => s.id),
  };
}

export type Churn = { activeAtStart: number; canceled: number; rate: number; revenueRate: number; canceledIds: string[] };

// Subscriber churn: subscriptions live at the window start that were canceled inside it, over those live at the start.
export function churn(subs: SubscriptionRecord[], now: number, days = 30): Churn {
  const from = now - days * DAY;
  const atStart = subs.filter((s) => isLiveAt(s, from));
  const canceled = atStart.filter((s) => s.canceledAt !== null && s.canceledAt <= now);
  const startMrr = atStart.reduce((sum, s) => sum + s.monthlyAmount, 0);
  return {
    activeAtStart: atStart.length,
    canceled: canceled.length,
    rate: atStart.length ? canceled.length / atStart.length : 0,
    revenueRate: startMrr ? canceled.reduce((sum, s) => sum + s.monthlyAmount, 0) / startMrr : 0,
    canceledIds: canceled.map((s) => s.id),
  };
}

export type Cohort = { month: string; size: number; retained: (number | null)[] };

const monthKey = (unix: number) => new Date(unix * 1000).toISOString().slice(0, 7);
const monthStart = (key: string) => Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, 1) / 1000;
const addMonths = (key: string, n: number) => {
  const d = new Date(monthStart(key) * 1000);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.getTime() / 1000;
};

// Subscriptions grouped by the month they started. retained[k] is the share still live at the end of month k after
// the start month (k = 0 is the start month itself), or null when that month has not ended yet. The current month
// is measured at now.
export function cohortRetention(subs: SubscriptionRecord[], now: number, maxMonths = 6): Cohort[] {
  const paying = subs.filter((s) => !NEVER_PAID.has(s.status) && s.startedAt <= now);
  const byMonth = new Map<string, SubscriptionRecord[]>();
  for (const sub of paying) byMonth.set(monthKey(sub.startedAt), [...(byMonth.get(monthKey(sub.startedAt)) ?? []), sub]);
  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, cohort]) => ({
      month,
      size: cohort.length,
      retained: Array.from({ length: maxMonths }, (_, k) => {
        const end = addMonths(month, k + 1) - 1;
        const monthBegins = addMonths(month, k);
        if (monthBegins > now) return null;
        const at = Math.min(end, now);
        return cohort.filter((s) => s.canceledAt === null || s.canceledAt > at).length / cohort.length;
      }),
    }));
}

export type DeclineRow = { key: string; attempts: number; failed: number; rate: number };

// Decline rate grouped by card brand or country over charge attempts in the window. Pending charges are left out.
export function declineRateBy(charges: ChargeRecord[], now: number, key: "brand" | "country", days = 30): DeclineRow[] {
  const from = now - days * DAY;
  const rows = new Map<string, { attempts: number; failed: number }>();
  for (const c of charges) {
    if (c.status === "pending" || c.time <= from || c.time > now) continue;
    const k = c[key] ?? "Unknown";
    const row = rows.get(k) ?? { attempts: 0, failed: 0 };
    rows.set(k, { attempts: row.attempts + 1, failed: row.failed + (c.status === "failed" ? 1 : 0) });
  }
  return [...rows.entries()]
    .map(([k, r]) => ({ key: k, ...r, rate: r.failed / r.attempts }))
    .sort((a, b) => b.attempts - a.attempts);
}

export function grossVolume(charges: ChargeRecord[], now: number, days = 30): { amount: number; count: number } {
  const from = now - days * DAY;
  const ok = charges.filter((c) => c.status === "succeeded" && c.time > from && c.time <= now);
  return { amount: ok.reduce((sum, c) => sum + c.amount, 0), count: ok.length };
}
