import { z } from "zod";
import { alertCard } from "@/lib/alerts/check";
import { loadAlertInput } from "@/lib/alerts/load";
import { evaluateAlerts, type AlertRuleId } from "@/lib/alerts/rules";
import type { AlertCard } from "@/lib/cards/types";
import { defineReadTool } from "../types";

// Which alert rules a question is about. Called by code after the analytics specialist answers, not by the model.
export function alertRulesForQuestion(question: string): AlertRuleId[] {
  const q = question.toLowerCase();
  if (/\b(alerts?|anomal\w*|unusual|spikes?|risk\w*|thresholds?|warnings?)\b/.test(q)) return ["chargeback_rate", "refund_spike", "decline_rate"];
  const rules: AlertRuleId[] = [];
  if (/\b(chargebacks?|disputes?|dispute rate)\b/.test(q)) rules.push("chargeback_rate");
  if (/\brefund\w*/.test(q)) rules.push("refund_spike");
  if (/\b(declin\w*|fail\w*)\b/.test(q)) rules.push("decline_rate");
  return rules;
}

export const showAlerts = defineReadTool({
  name: "show_alerts",
  description: "Evaluate the alert rules (chargeback rate, refund spike, decline rate) and show the firing ones as cards.",
  input: z.object({ rules: z.array(z.enum(["chargeback_rate", "refund_spike", "decline_rate"])).min(1).max(3) }),
  run: async ({ rules }, { stripe, now }): Promise<{ cards: AlertCard[]; stripe_ids: string[] }> => {
    const firing = evaluateAlerts(await loadAlertInput(stripe, now)).filter((r) => r.firing && rules.includes(r.rule));
    // The records behind each value, so Sources can cite them.
    return { cards: firing.map(alertCard), stripe_ids: firing.flatMap((r) => r.stripeIds).slice(0, 25) };
  },
});
