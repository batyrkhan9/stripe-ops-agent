import type Stripe from "stripe";
import type { AlertCard } from "@/lib/cards/types";
import type { Db } from "@/lib/db/client";
import { loadAlertInput } from "./load";
import { evaluateAlerts, type AlertResult } from "./rules";
import { recordFiringAlerts, type AlertTrigger } from "./store";

const ACTIONS: Record<AlertResult["rule"], AlertCard["action"]> = {
  chargeback_rate: { label: "Open disputes", href: "/disputes" },
  refund_spike: { label: "View alert", href: "/alerts#refund_spike" },
  decline_rate: { label: "Open recovery", href: "/recovery" },
};

export function alertCard(result: AlertResult): AlertCard {
  return {
    kind: "alert",
    id: result.rule,
    title: result.name,
    amount: result.valueLabel,
    status: result.severity === "critical" ? "Critical" : result.severity === "warning" ? "Warning" : "OK",
    summary: result.summary,
    window: result.windowLabel,
    details: [`Threshold: ${result.thresholdLabel}`],
    urgent: result.firing,
    action: ACTIONS[result.rule],
  };
}

// Page loads within a minute reuse one evaluation per account and "now", so the dashboard and /alerts do not
// each list 30 days of charges.
const recent = new Map<string, { at: number; results: AlertResult[] }>();
const REUSE_MS = 60_000;

export async function checkAlerts({
  db,
  stripe,
  accountId,
  now,
  trigger,
}: {
  db: Db;
  stripe: Stripe;
  accountId: string;
  now: number;
  trigger: AlertTrigger;
}): Promise<AlertResult[]> {
  const key = `${accountId}:${now}`;
  const cached = recent.get(key);
  if (trigger === "page_load" && cached && Date.now() - cached.at < REUSE_MS) return cached.results;

  const results = evaluateAlerts(await loadAlertInput(stripe, now));
  recent.set(key, { at: Date.now(), results });
  // History is best effort: a failed insert must not hide a firing alert from the page.
  await recordFiringAlerts(db, { accountId, now, trigger, results }).catch((error: unknown) => console.error("alert history insert failed", error));
  return results;
}
