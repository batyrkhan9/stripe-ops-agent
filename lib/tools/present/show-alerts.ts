import { z } from "zod";
import { alertCard } from "@/lib/alerts/check";
import { loadAlertInput } from "@/lib/alerts/load";
import { evaluateAlerts, type AlertRuleId } from "@/lib/alerts/rules";
import type { AlertCard } from "@/lib/cards/types";
import { defineReadTool } from "../types";

// Which alert rules a question is about. Called by code after the analytics specialist answers, not by the model.
// Eval run 1 showed the 7 day decline card on 30 day and per-brand questions, where it contradicted the answer. A card
// now shows only when the question is about the rule's own measure, not a single card brand or country.
export function alertRulesForQuestion(question: string): AlertRuleId[] {
  const q = question.toLowerCase();
  if (/\b(alerts?|anomal\w*|unusual|spikes?|risk\w*|thresholds?|warnings?)\b/.test(q)) return ["chargeback_rate", "refund_spike", "decline_rate"];
  const rules: AlertRuleId[] = [];
  const perCard = /\b(visa|mastercard|amex|american express|discover|brand|country|countries|issued in)\b/.test(q);
  if (/\b(chargeback|dispute) rate\b/.test(q)) rules.push("chargeback_rate");
  if (/\brefunds?\b/.test(q) && /\b(24 hours|today|yesterday|recent)\b/.test(q)) rules.push("refund_spike");
  if (/\b(decline|failure) rate\b/.test(q) && /\b(7 days|week)\b/.test(q) && !perCard) rules.push("decline_rate");
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
