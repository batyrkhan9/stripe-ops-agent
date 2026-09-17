// pnpm eval:format  Runs the answer format cases through the real agent on the demo account.
import { readFileSync, writeFileSync } from "node:fs";
import { config } from "dotenv";
import { desc, isNotNull } from "drizzle-orm";
import { visibleAnswerText } from "@/lib/agents/present";
import { runAgentChat } from "@/lib/agents/run";
import type { AgentUIMessage } from "@/lib/agents/ui-types";
import type { Sources } from "@/lib/agents/sources";
import type { Card, NextAction } from "@/lib/cards/types";
import { createDb } from "@/lib/db/client";
import { auditLog, seedRuns } from "@/lib/db/schema";
import { agentModel, finishModel } from "@/lib/llm/provider";
import { createStripeClient } from "@/lib/stripe/client";
import type { Span } from "@/lib/trace/recorder";
import { checkAnswerRules, type CapturedAnswer, type FormatExpectations, type RuleResult } from "@/lib/agents/answer-rules";

config({ path: ".env.local", quiet: true });

type Case = { id: string; question: string; agent: string; expect: FormatExpectations };

const PAUSE_MS = 20_000; // stay under Groq's 8000 tokens a minute

async function main() {
  const cases = JSON.parse(readFileSync("evals/format-cases.json", "utf8")) as Case[];
  const db = createDb(process.env.DATABASE_URL);
  const [run] = await db.select().from(seedRuns).where(isNotNull(seedRuns.completedAt)).orderBy(desc(seedRuns.completedAt)).limit(1);
  if (!run) throw new Error("no completed seed run");
  const stripe = createStripeClient(process.env.STRIPE_DEMO_KEY, "STRIPE_DEMO_KEY");
  const rows: { id: string; question: string; routed: string; models: string; results: RuleResult[]; answer: CapturedAnswer; rawText: string }[] = [];

  for (const [index, testCase] of cases.entries()) {
    if (index > 0) await new Promise((r) => setTimeout(r, PAUSE_MS));
    let spans: Span[] = [];
    let routed = "";
    let runError: string | undefined;
    const messages: AgentUIMessage[] = [{ id: "q", role: "user", parts: [{ type: "text", text: testCase.question }] }];
    const stream = runAgentChat(messages, {
      stripe,
      mode: "demo",
      accountId: "eval:format",
      now: Math.floor(run.anchorAt.getTime() / 1000),
      model: agentModel,
      finishModel,
      audit: async (record) => {
        await db.insert(auditLog).values({ accountId: "eval:format", agent: record.agent, tool: record.tool, params: record.params ?? {}, stripeIds: record.stripeIds, result: record.result as object });
      },
      saveRun: async (r) => {
        spans = r.spans;
        routed = r.plan?.agents.join("+") ?? "";
        runError = r.error;
      },
    });

    const answer: CapturedAnswer = { text: "", cards: [], nextAction: null, sources: null, tools: [] };
    const toolNames = new Map<string, string>();
    const reader = stream.getReader();
    for (let next = await reader.read(); !next.done; next = await reader.read()) {
      const chunk = next.value;
      if (chunk.type === "text-delta") answer.text += chunk.delta;
      else if (chunk.type === "text-end") answer.text += "\n\n";
      else if (chunk.type === "tool-input-available") {
        toolNames.set(chunk.toolCallId, chunk.toolName);
        answer.tools.push(chunk.toolName);
      } else if (chunk.type === "tool-output-available") {
        const name = toolNames.get(chunk.toolCallId);
        void name;
      } else if (chunk.type === "data-sources") answer.sources = chunk.data as Sources;
      else if (chunk.type === "data-next") answer.nextAction = chunk.data as NextAction;
      else if (chunk.type === "data-cards") answer.cards.push(...((chunk.data as { cards: Card[] }).cards ?? []));
    }
    // Check what the merchant sees, the same transformation the chat page applies.
    const rawText = answer.text.trim();
    answer.text = visibleAnswerText(rawText, answer.cards.length > 0);

    const results = checkAnswerRules(answer, testCase.expect);
    if (routed && routed !== testCase.agent) results.push({ rule: "routing", pass: false, detail: `routed to ${routed}, expected ${testCase.agent}` });
    else results.push({ rule: "routing", pass: true });
    const models = [...new Set(spans.filter((s) => s.kind === "llm").map((s) => s.modelId))].join(", ");
    const errors = [runError, ...spans.filter((s) => s.error && s.kind !== "tool").map((s) => `${s.name}: ${s.error}`)].filter(Boolean);
    if (errors.length) results.push({ rule: "no_step_errors", pass: false, detail: errors.join(" / ").slice(0, 300) });
    rows.push({ id: testCase.id, question: testCase.question, routed, models, results, answer, rawText });
    const failed = results.filter((r) => !r.pass);
    console.log(`${testCase.id} ${failed.length ? "FAIL" : "pass"} (${models}) ${failed.map((f) => `${f.rule}: ${f.detail}`).join(" | ")}`);
  }

  const passed = rows.filter((r) => r.results.every((x) => x.pass)).length;
  const md = [
    "# Answer format eval results",
    "",
    `Run ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC on the demo account. ${passed} of ${rows.length} cases pass every rule.`,
    "",
    "Rules are checked on the rendered answer. Enforced by code: cards for disputes and invoices, no IDs in cards or",
    "next actions, only the lead paragraph shown when cards are shown, bold kept once, next action and its page button.",
    "Depends on the model: lead length, IDs and ISO dates in text, tables, generic advice, facts, routing.",
    "",
    "| Case | Question | Result | Failed rules | Model |",
    "|---|---|---|---|---|",
    ...rows.map((r) => {
      const failed = r.results.filter((x) => !x.pass);
      return `| ${r.id} | ${r.question} | ${failed.length ? "fail" : "pass"} | ${failed.map((f) => `${f.rule}: ${(f.detail ?? "").replace(/\|/g, "/")}`).join("; ") || "none"} | ${r.models} |`;
    }),
    "",
    "## Answers",
    ...rows.flatMap((r) => [
      "",
      `### ${r.id}: ${r.question}`,
      "",
      "Rendered:",
      "",
      "```text",
      r.answer.text || "(no text)",
      "```",
      ...(r.rawText !== r.answer.text ? ["", "Model text before rendering:", "", "```text", r.rawText, "```"] : []),
      "",
      `Cards: ${r.answer.cards.map((c) => `${c.title} ${c.amount}${c.kind === "dispute" ? ` ${c.due}` : ` ${c.failure}`}`).join("; ") || "none"}`,
      "",
      `Next action: ${r.answer.nextAction ? `${r.answer.nextAction.text}${r.answer.nextAction.button ? ` [${r.answer.nextAction.button.label}]` : ""}` : "none"}`,
    ]),
    "",
  ].join("\n");
  writeFileSync("evals/format-results.md", md);
  console.log(`\n${passed}/${rows.length} cases pass. Wrote evals/format-results.md`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
