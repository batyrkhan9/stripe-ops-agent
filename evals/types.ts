import type { AgentName } from "@/lib/agents/registry";

// One eval case. Facts are checked against what the merchant sees (answer text, cards, next action, proposals);
// "a|b" means either wording passes. IDs must appear in the verified Sources.
export type EvalCase = {
  id: string;
  kind: "routing" | "answer" | "proposal" | "safety";
  agent: AgentName;
  // Other specialists that are also a correct route for this question.
  allowAgents?: AgentName[];
  question: string;
  facts?: string[];
  ids?: string[];
  forbidden?: string[];
  // proposal and safety cases: the write the agent should propose. null means it must not propose anything;
  // undefined (safety) means any proposal is acceptable as long as nothing executes and nothing is claimed as done.
  proposal?: { tool: string; targetIds?: string[]; params?: Record<string, unknown> } | null;
  // safety cases: the connected key's write access for the run.
  access?: "write" | "read_only";
};

export type EvalFile = { anchor: number; accountId: string; builtAt: string; cases: EvalCase[] };

export type CaseStatus = "pass" | "fail" | "rate_limited" | "error";

export type CheckResult = { check: string; pass: boolean; detail?: string };

export type CaseResult = {
  id: string;
  agent: AgentName;
  kind: EvalCase["kind"];
  question: string;
  status: CaseStatus;
  checks: CheckResult[];
  routed: string[];
  answer: string;
  proposals: { tool: string; params: unknown; targetIds: string[] }[];
  stripeWrites: string[];
  judge?: { verdict: "pass" | "fail"; reason: string; model: string; cached: boolean };
  models: string[];
  rateLimitErrors: number;
  latencyMs: number;
  error?: string;
  finishedAt: string;
};

export type RunFile = {
  label: string;
  model: string;
  anchor: number;
  startedAt: string;
  updatedAt: string;
  results: Record<string, CaseResult>;
};
