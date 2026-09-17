import type Stripe from "stripe";
import { effectiveTime } from "@/lib/tools/format";
import { collectByDate } from "@/lib/tools/types";
import type { AlertInput, DatedCharge } from "./rules";

const chargeStatus = (status: string): DatedCharge["status"] => (status === "succeeded" || status === "failed" ? status : "pending");

// Reads the trailing windows the rules need, dated by occurred_at in demo mode (ADR 0001). Experiment leftovers are
// skipped by collectByDate, as in the agent tools, so alerts and answers agree on the same numbers.
export async function loadAlertInput(stripe: Stripe, now: number): Promise<AlertInput> {
  const [charges, disputes, refunds] = await Promise.all([
    collectByDate(stripe.charges.list({ limit: 100 }), { now, days: 30 }),
    collectByDate(stripe.disputes.list({ limit: 100 }), { now, days: 30 }),
    collectByDate(stripe.refunds.list({ limit: 100 }), { now, days: 2 }),
  ]);
  return {
    now,
    charges: charges.map((c) => ({ id: c.id, time: effectiveTime(c), status: chargeStatus(c.status) })),
    disputes: disputes.map((d) => ({ id: d.id, time: effectiveTime(d) })),
    refunds: refunds.filter((r) => r.status !== "failed" && r.status !== "canceled").map((r) => ({ id: r.id, time: effectiveTime(r) })),
  };
}
