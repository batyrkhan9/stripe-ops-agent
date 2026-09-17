// Anomaly rules (docs/spec.md, P1 and P5). Pure functions over dated records, so they run the same on page load,
// after a webhook, and in cron, and take "now" as a parameter (frozen in demo mode, ADR 0001).

const HOUR = 3_600;
const DAY = 24 * HOUR;

export type DatedCharge = { id: string; time: number; status: "succeeded" | "failed" | "pending" };
export type DatedRecord = { id: string; time: number };

export type AlertInput = {
  now: number;
  charges: DatedCharge[]; // at least the trailing 30 days
  disputes: DatedRecord[];
  refunds: DatedRecord[];
};

export type AlertRuleId = "refund_spike" | "chargeback_rate" | "decline_rate";

export type AlertResult = {
  rule: AlertRuleId;
  name: string;
  firing: boolean;
  severity: "warning" | "critical" | null;
  value: number; // count for refund_spike, fraction for the rates
  valueLabel: string;
  thresholdLabel: string;
  windowLabel: string;
  summary: string; // one plain sentence
  stripeIds: string[]; // the records behind the value, for Sources and the audit trail
};

export const THRESHOLDS = {
  refundSpikeCount: 3,
  chargebackWarn: 0.005, // warn before Stripe's 0.75% monitoring threshold
  chargebackStripe: 0.0075,
  declineRate: 0.15,
} as const;

const inWindow = (time: number, now: number, seconds: number) => time > now - seconds && time <= now;

export function percentLabel(fraction: number): string {
  return `${(fraction * 100).toFixed(2)}%`;
}

export function refundSpike({ now, refunds }: AlertInput): AlertResult {
  const recent = refunds.filter((r) => inWindow(r.time, now, DAY));
  const firing = recent.length >= THRESHOLDS.refundSpikeCount;
  return {
    rule: "refund_spike",
    name: "Refund spike",
    firing,
    severity: firing ? "warning" : null,
    value: recent.length,
    valueLabel: `${recent.length} refund${recent.length === 1 ? "" : "s"}`,
    thresholdLabel: `${THRESHOLDS.refundSpikeCount} or more in 24 hours`,
    windowLabel: "Last 24 hours",
    summary: firing
      ? `${recent.length} refunds in the last 24 hours, at or above the ${THRESHOLDS.refundSpikeCount} refund spike threshold.`
      : `${recent.length} refund${recent.length === 1 ? "" : "s"} in the last 24 hours.`,
    stripeIds: recent.map((r) => r.id),
  };
}

// Disputes opened in the window over successful charges in the window, the same measure the analytics tools use.
export function chargebackRate({ now, charges, disputes }: AlertInput): AlertResult {
  const window = 30 * DAY;
  const succeeded = charges.filter((c) => c.status === "succeeded" && inWindow(c.time, now, window)).length;
  const recent = disputes.filter((d) => inWindow(d.time, now, window));
  const rate = succeeded ? recent.length / succeeded : 0;
  const severity = rate >= THRESHOLDS.chargebackStripe ? "critical" : rate > THRESHOLDS.chargebackWarn ? "warning" : null;
  return {
    rule: "chargeback_rate",
    name: "Chargeback rate",
    firing: severity !== null,
    severity,
    value: rate,
    valueLabel: percentLabel(rate),
    thresholdLabel: `warn over ${percentLabel(THRESHOLDS.chargebackWarn)}, Stripe monitors at ${percentLabel(THRESHOLDS.chargebackStripe)}`,
    windowLabel: "Last 30 days",
    summary:
      severity === "critical"
        ? `${recent.length} disputes on ${succeeded} successful charges is ${percentLabel(rate)}, at or over Stripe's ${percentLabel(THRESHOLDS.chargebackStripe)} threshold.`
        : severity === "warning"
          ? `${recent.length} disputes on ${succeeded} successful charges is ${percentLabel(rate)}, over the ${percentLabel(THRESHOLDS.chargebackWarn)} warning and below Stripe's ${percentLabel(THRESHOLDS.chargebackStripe)}.`
          : `${recent.length} dispute${recent.length === 1 ? "" : "s"} on ${succeeded} successful charges is ${percentLabel(rate)}.`,
    stripeIds: recent.map((d) => d.id),
  };
}

export function declineRate({ now, charges }: AlertInput): AlertResult {
  const recent = charges.filter((c) => c.status !== "pending" && inWindow(c.time, now, 7 * DAY));
  const failed = recent.filter((c) => c.status === "failed");
  const rate = recent.length ? failed.length / recent.length : 0;
  const firing = rate > THRESHOLDS.declineRate;
  return {
    rule: "decline_rate",
    name: "Decline rate",
    firing,
    severity: firing ? "warning" : null,
    value: rate,
    valueLabel: percentLabel(rate),
    thresholdLabel: `over ${percentLabel(THRESHOLDS.declineRate)}`,
    windowLabel: "Last 7 days",
    summary: `${failed.length} of ${recent.length} charge attempts failed, ${percentLabel(rate)}${firing ? `, over the ${percentLabel(THRESHOLDS.declineRate)} threshold` : ""}.`,
    stripeIds: failed.map((c) => c.id),
  };
}

export function evaluateAlerts(input: AlertInput): AlertResult[] {
  return [chargebackRate(input), refundSpike(input), declineRate(input)];
}
