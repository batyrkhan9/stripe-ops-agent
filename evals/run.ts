// pnpm eval [--suite cases|safety|all] [--model chain|gpt-oss-120b|gemini-3.5-flash-lite|qwen3.8-27b] [--label name]
//           [--sample N] [--ids a,b] [--pause ms] [--fresh] [--strict]
// Runs eval cases through the real agents on the demo account and writes evals/runs/<label>.json after every case.
// Rerunning the same label resumes: finished cases (pass or fail) are skipped, rate-limited and errored cases rerun.
// Nothing can write to Stripe: the client blocks write methods, confirmations are never called, and proposals and
// audit rows stay in memory.
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { convertToModelMessages } from "ai";
import { config } from "dotenv";
import type { LanguageModelV4 } from "@ai-sdk/provider";
import { planRoute } from "@/lib/agents/planner/plan";
import { runAgentChat } from "@/lib/agents/run";
import type { AgentUIMessage } from "@/lib/agents/ui-types";
import { cardLines } from "@/lib/cards/types";
import { capturedAnswer, type AgentChunk } from "@/lib/demo/answer-cache";
import { agentModel, BENCHMARK_MODELS, finishModel, singleModel, type BenchmarkModel, type ServedBy } from "@/lib/llm/provider";
import { createStripeClient } from "@/lib/stripe/client";
import type { KeyPermissions } from "@/lib/stripe/permissions";
import { blockStripeWrites, checkCase, visibleText, type CapturedProposal } from "./checks";
import { judge, JudgeCache } from "./judge";
import type { CaseResult, EvalCase, EvalFile, RunFile } from "./types";

config({ path: ".env.local", quiet: true });

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const flag = (name: string) => process.argv.includes(`--${name}`);

const suite = arg("suite") ?? "all";
const modelName = arg("model") ?? "chain";
const label = arg("label") ?? (modelName === "chain" ? "chain" : `bench-${modelName}`);
const pauseMs = Number(arg("pause") ?? 12_000);

type ModelFactory = (onServed: (s: ServedBy) => void) => LanguageModelV4;

function models(): { agent: ModelFactory; finish: ModelFactory } {
  if (modelName === "chain") return { agent: agentModel, finish: finishModel };
  if (!(modelName in BENCHMARK_MODELS)) throw new Error(`unknown model ${modelName}; use chain or ${Object.keys(BENCHMARK_MODELS).join(", ")}`);
  const single = singleModel(modelName as BenchmarkModel);
  return { agent: single, finish: single };
}

const permissions = (write: boolean): KeyPermissions => ({
  read: { charges: true, customers: true, subscriptions: true, invoices: true, disputes: true, refunds: true, balance: true },
  write: { refunds: write, coupons: write, subscriptions: write, disputes: write },
  accountId: null,
});

// Seeded shuffle so a CI sample is stable for one run ID and different across runs.
function sample<T>(items: T[], n: number, seed: number): T[] {
  let state = seed >>> 0;
  const rand = () => ((state = (state * 1664525 + 1013904223) >>> 0) / 4_294_967_296);
  return [...items].sort(() => rand() - 0.5).slice(0, n);
}

async function runCase(testCase: EvalCase, anchor: number, cache: JudgeCache): Promise<CaseResult> {
  const { agent, finish } = models();
  const failures: string[] = [];
  const modelsUsed = new Set<string>();
  const track = (factory: ModelFactory): ModelFactory => (onServed) =>
    factory((s) => {
      failures.push(...s.failures);
      modelsUsed.add(s.modelId);
      onServed(s);
    });
  const started = Date.now();
  const base = {
    id: testCase.id,
    agent: testCase.agent,
    kind: testCase.kind,
    question: testCase.question,
    finishedAt: "",
  };
  const messages: AgentUIMessage[] = [{ id: "q", role: "user", parts: [{ type: "text", text: testCase.question }] }];
  const rateLimits = () => failures.filter((f) => /429|413/.test(f)).length;

  if (testCase.kind === "routing") {
    const plan = await planRoute(track(agent)(() => undefined), await convertToModelMessages(messages), testCase.question);
    const checks = checkCase(testCase, { routed: plan.agents, answer: capturedAnswer([]), proposals: [], stripeWrites: [] });
    const limited = plan.source === "keywords" && /429|rate limit|quota/i.test(plan.error ?? "");
    return {
      ...base,
      status: limited ? "rate_limited" : checks.every((c) => c.pass) ? "pass" : "fail",
      checks,
      routed: plan.agents,
      answer: "",
      proposals: [],
      stripeWrites: [],
      models: [...modelsUsed],
      rateLimitErrors: rateLimits() + (limited ? 1 : 0),
      latencyMs: Date.now() - started,
      error: plan.source === "keywords" ? `planner fell back to keywords: ${plan.error ?? plan.reason}` : undefined,
      finishedAt: new Date().toISOString(),
    };
  }

  const stripeWrites: string[] = [];
  const proposals: CapturedProposal[] = [];
  const stripe = blockStripeWrites(createStripeClient(process.env.STRIPE_DEMO_KEY, "STRIPE_DEMO_KEY"), stripeWrites);
  const connected = testCase.kind === "safety";
  let routed: string[] = [];
  let runError: string | undefined;
  const stream = runAgentChat(messages, {
    stripe,
    mode: connected ? "connected" : "demo",
    accountId: "eval",
    now: anchor,
    model: track(agent),
    finishModel: track(finish),
    audit: async () => undefined,
    writes: {
      accountId: "eval",
      connectionId: connected ? "eval-connection" : null,
      permissions: connected ? permissions(testCase.access === "write") : null,
      saveProposal: async (proposal) => {
        proposals.push({ tool: proposal.tool, params: proposal.params, targetIds: proposal.targetIds });
        return randomUUID();
      },
    },
    saveRun: async (run) => {
      routed = run.plan?.agents ?? [];
      runError = run.error;
    },
  });
  const chunks: AgentChunk[] = [];
  const reader = stream.getReader();
  for (let next = await reader.read(); !next.done; next = await reader.read()) chunks.push(next.value);
  const errorChunk = chunks.find((c) => c.type === "error");
  if (errorChunk && !runError) runError = (errorChunk as { errorText: string }).errorText;
  const answer = capturedAnswer(chunks);
  const checks = checkCase(testCase, { routed, answer, proposals, stripeWrites, runError });
  const shown = [
    visibleText(answer),
    ...proposals.map((p) => `Proposed action awaiting confirmation: ${p.tool} ${JSON.stringify(p.params)}`),
    answer.cards.length ? `Cards: ${answer.cards.map((c) => `${c.title} ${c.amount} ${cardLines(c).secondary}`).join("; ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const limited = rateLimits();
  const noAnswer = !answer.text.trim();

  let judgeResult: CaseResult["judge"];
  let status: CaseResult["status"] = checks.every((c) => c.pass) ? "pass" : "fail";
  if (noAnswer && limited > 0) status = "rate_limited";
  else if (testCase.kind !== "safety") {
    const verdict = await judge(testCase, shown, cache);
    if ("error" in verdict) {
      status = "rate_limited";
      checks.push({ check: "judge", pass: false, detail: `judge unavailable: ${verdict.error}` });
    } else {
      judgeResult = verdict;
      checks.push({ check: "judge", pass: verdict.verdict === "pass", ...(verdict.verdict === "pass" ? {} : { detail: verdict.reason }) });
      if (verdict.verdict === "fail") status = "fail";
    }
  }
  return {
    ...base,
    status,
    checks,
    routed,
    answer: shown,
    proposals,
    stripeWrites,
    judge: judgeResult,
    models: [...modelsUsed],
    rateLimitErrors: limited,
    latencyMs: Date.now() - started,
    error: runError,
    finishedAt: new Date().toISOString(),
  };
}

async function main() {
  const files: EvalFile[] = [];
  if (suite === "cases" || suite === "all") files.push(JSON.parse(readFileSync("evals/cases.json", "utf8")) as EvalFile);
  if (suite === "safety" || suite === "all") files.push(JSON.parse(readFileSync("evals/safety.json", "utf8")) as EvalFile);
  const anchor = files[0]!.anchor;
  let cases = files.flatMap((f) => f.cases);
  const ids = arg("ids")?.split(",");
  if (ids) cases = cases.filter((c) => ids.includes(c.id));
  const sampleSize = arg("sample");
  if (sampleSize) cases = sample(cases, Number(sampleSize), Number(arg("seed") ?? process.env.GITHUB_RUN_ID ?? Date.now()));

  mkdirSync("evals/runs", { recursive: true });
  const path = `evals/runs/${label}.json`;
  const run: RunFile =
    existsSync(path) && !flag("fresh")
      ? (JSON.parse(readFileSync(path, "utf8")) as RunFile)
      : { label, model: modelName, anchor, startedAt: new Date().toISOString(), updatedAt: "", results: {} };
  const cache = new JudgeCache();
  const todo = cases.filter((c) => !["pass", "fail"].includes(run.results[c.id]?.status ?? ""));
  console.log(`${label}: ${cases.length - todo.length} of ${cases.length} already finished, ${todo.length} to run on ${modelName}`);

  let consecutiveLimits = 0;
  for (const [index, testCase] of todo.entries()) {
    if (index > 0) await new Promise((r) => setTimeout(r, pauseMs));
    let result: CaseResult;
    try {
      result = await runCase(testCase, anchor, cache);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result = {
        id: testCase.id,
        agent: testCase.agent,
        kind: testCase.kind,
        question: testCase.question,
        status: /429|rate limit|quota/i.test(message) ? "rate_limited" : "error",
        checks: [],
        routed: [],
        answer: "",
        proposals: [],
        stripeWrites: [],
        models: [],
        rateLimitErrors: /429|rate limit|quota/i.test(message) ? 1 : 0,
        latencyMs: 0,
        error: message.slice(0, 300),
        finishedAt: new Date().toISOString(),
      };
    }
    run.results[testCase.id] = result;
    run.updatedAt = new Date().toISOString();
    writeFileSync(path, `${JSON.stringify(run, null, 1)}\n`);
    const failed = result.checks.filter((c) => !c.pass).map((c) => `${c.check}${c.detail ? ` (${c.detail.slice(0, 120)})` : ""}`);
    console.log(`${testCase.id} ${result.status} ${(result.latencyMs / 1000).toFixed(1)}s [${result.models.join(", ")}] ${failed.join("; ")}`);
    consecutiveLimits = result.status === "rate_limited" ? consecutiveLimits + 1 : 0;
    // Five rate-limited cases in a row means a daily quota is gone. Stop; rerunning the same label resumes.
    if (consecutiveLimits >= 5) {
      console.log("Stopping: 5 rate-limited cases in a row. Rerun the same command later to resume.");
      break;
    }
  }

  const all = cases.map((c) => run.results[c.id]).filter((r): r is CaseResult => Boolean(r));
  const done = all.filter((r) => r.status === "pass" || r.status === "fail");
  const passed = done.filter((r) => r.status === "pass").length;
  const safety = all.filter((r) => r.kind === "safety");
  const safetyFailed = safety.filter((r) => r.status !== "pass");
  console.log(`\n${label}: ${passed}/${done.length} finished cases pass (${cases.length - done.length} not finished). Safety: ${safety.filter((r) => r.status === "pass").length}/${safety.length}.`);
  // --strict (CI): any safety case that did not pass fails the job, including one that could not run.
  if (flag("strict") && safetyFailed.length) {
    console.log(`Safety cases not passing: ${safetyFailed.map((r) => `${r.id} (${r.status})`).join(", ")}`);
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
