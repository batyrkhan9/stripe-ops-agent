import { generateText, type LanguageModel, type ModelMessage } from "ai";
import { PROVIDER_OPTIONS } from "@/lib/llm/provider";
import { AGENT_NAMES, type AgentName } from "../registry";
import { PLANNER_PROMPT } from "./prompt";

export type Plan = {
  agents: AgentName[];
  reason: string;
  source: "model" | "keywords";
  error?: string;
};

// Used when the planner model fails or answers with no specialist name, so routing never blocks an answer.
export function routeByKeywords(question: string): AgentName[] {
  const q = question.toLowerCase();
  const asksForChange =
    /^(please\s+)?(refund|cancel|pause|resume|create|give|issue|apply)\b/.test(q) ||
    /\b(can|could|would) you\b.*\b(refund|cancel|pause|coupon|discount)\b|\bplease\b.*\b(refund|cancel|pause|coupon|discount)\b/.test(q);
  if (asksForChange) return ["actions"];
  if (/\b(rate|ratio|mrr|revenue|volume|how many|how much|total|average|trend|churn)\b/.test(q)) return ["analytics"];
  if (/disput|chargeback|evidence|inquiry/.test(q)) return ["disputes"];
  if (/fail|declin|past.?due|dunning|retry|unpaid|overdue|open invoice/.test(q)) return ["recovery"];
  return ["analytics"];
}

// Plain text reply parsed against the known names. Structured JSON output was dropped because Groq's
// gpt-oss models intermittently reject it with "Failed to generate JSON".
export function parsePlannerReply(reply: string): AgentName[] {
  const found = AGENT_NAMES.filter((name) => new RegExp(`\\b${name}\\b`, "i").test(reply));
  const ordered = found.sort((a, b) => reply.toLowerCase().indexOf(a) - reply.toLowerCase().indexOf(b));
  return ordered.slice(0, 2);
}

export async function planRoute(model: LanguageModel, messages: ModelMessage[], question: string): Promise<Plan> {
  try {
    const result = await generateText({
      model,
      instructions: PLANNER_PROMPT,
      messages: messages.slice(-4),
      maxRetries: 0,
      maxOutputTokens: 300,
      providerOptions: PROVIDER_OPTIONS,
    });
    const agents = parsePlannerReply(result.text);
    if (agents.length > 0) return { agents, reason: result.text.trim().slice(0, 200), source: "model" };
    return { agents: routeByKeywords(question), reason: "planner named no specialist", source: "keywords", error: result.text.slice(0, 200) };
  } catch (error) {
    return {
      agents: routeByKeywords(question),
      reason: "planner unavailable",
      source: "keywords",
      error: error instanceof Error ? error.message.slice(0, 300) : String(error),
    };
  }
}
