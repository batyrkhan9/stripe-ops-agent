import type { ReadToolName } from "@/lib/tools/read";
import { ACTIONS_PROMPT } from "./actions/prompt";
import { ACTIONS_TOOLS } from "./actions/tools";
import { ANALYTICS_PROMPT } from "./analytics/prompt";
import { ANALYTICS_TOOLS } from "./analytics/tools";
import { DISPUTES_PROMPT } from "./disputes/prompt";
import { DISPUTES_TOOLS } from "./disputes/tools";
import { RECOVERY_PROMPT } from "./recovery/prompt";
import { RECOVERY_TOOLS } from "./recovery/tools";

export const AGENT_NAMES = ["disputes", "recovery", "analytics", "actions"] as const;
export type AgentName = (typeof AGENT_NAMES)[number];

export const SPECIALISTS: Record<AgentName, { prompt: string; tools: readonly ReadToolName[]; summary: string }> = {
  disputes: { prompt: DISPUTES_PROMPT, tools: DISPUTES_TOOLS, summary: "disputes, chargebacks, evidence, deadlines" },
  recovery: { prompt: RECOVERY_PROMPT, tools: RECOVERY_TOOLS, summary: "failed payments, declines, open or past-due invoices, dunning" },
  analytics: { prompt: ANALYTICS_PROMPT, tools: ANALYTICS_TOOLS, summary: "revenue, volume, refunds, customers, subscriptions, balance, rates" },
  actions: { prompt: ACTIONS_PROMPT, tools: ACTIONS_TOOLS, summary: "requests to refund, create a coupon, pause or cancel a subscription" },
};
