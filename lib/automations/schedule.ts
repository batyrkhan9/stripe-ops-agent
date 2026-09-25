import type Stripe from "stripe";
import { checkAlerts } from "@/lib/alerts/check";
import { loadAnalyticsData } from "@/lib/analytics/load";
import { buildAnalyticsSummary } from "@/lib/analytics/summary";
import { loadFailedInvoices, loadOpenDisputes } from "@/lib/cards/load";
import { scheduleContext } from "./context";
import { runRules, type ExecutorDeps } from "./executor";
import { enabledRules, type RuleScope } from "./store";

// Daily snapshot for schedule rules, then every enabled rule runs against it.
export async function runScheduledRules(deps: Omit<ExecutorDeps, "propose" | "draft">, scope: RuleScope, trigger: "cron" | "page") {
  const rules = (await enabledRules(deps.db, scope)).filter((r) => (r.rule as { trigger: { type: string } }).trigger.type === "schedule");
  if (!rules.length) return { ran: 0, matched: 0 };
  const [alerts, disputes, invoices, analytics] = await Promise.all([
    checkAlerts({ db: deps.db, stripe: deps.stripe as Stripe, accountId: deps.accountId, now: deps.now, trigger: "cron" }),
    loadOpenDisputes(deps.stripe, deps.now),
    loadFailedInvoices(deps.stripe, deps.now),
    loadAnalyticsData(deps.stripe, deps.now),
  ]);
  const ctx = scheduleContext({ alerts, summary: buildAnalyticsSummary(analytics, deps.now), failedInvoices: invoices.length, openDisputes: disputes.length });
  return runRules(rules, ctx, deps, scope, trigger);
}
