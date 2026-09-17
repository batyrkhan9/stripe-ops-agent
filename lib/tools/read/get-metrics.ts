import { z } from "zod";
import { loadAnalyticsData } from "@/lib/analytics/load";
import { buildAnalyticsSummary, summaryFacts } from "@/lib/analytics/summary";
import { defineReadTool } from "../types";

// The same numbers as the Analytics page, so chat answers and the page never disagree. Added for MRR and churn
// questions: list tools return at most 25 rows, too few to compute MRR from (docs/decisions-while-away.md).
export const getMetrics = defineReadTool({
  name: "get_metrics",
  description:
    "Revenue metrics computed by the app: MRR now and 30 days ago, new and churned MRR, subscriber and revenue churn over 30 days, gross volume over 30 days, cohort retention, and decline rate by card brand and country. Use for any MRR, churn, retention, or decline-by-card question.",
  input: z.object({}),
  run: async (_input, { stripe, now }) => {
    const summary = buildAnalyticsSummary(await loadAnalyticsData(stripe, now), now);
    return {
      metrics: summaryFacts(summary).split("\n"),
      new_subscriptions: summary.movement.newIds,
      canceled_subscriptions: summary.movement.churnedIds,
    };
  },
});
