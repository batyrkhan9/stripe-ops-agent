// pnpm demo:warm [--refresh]  Answers each demo question once and stores clean runs, so the first visitor gets a
// cached answer. Run after reseeding or changing a prompt or tool. Questions already cached for the current version
// are skipped unless --refresh is passed, which re-answers all of them (use it after reading a bad cached answer).
import { config } from "dotenv";
import { desc, isNotNull } from "drizzle-orm";
import { runAgentChat } from "@/lib/agents/run";
import type { AgentUIMessage } from "@/lib/agents/ui-types";
import { saveProposal } from "@/lib/actions/store";
import { createDb } from "@/lib/db/client";
import { auditLog, seedRuns } from "@/lib/db/schema";
import { agentModel, finishModel } from "@/lib/llm/provider";
import { createStripeClient } from "@/lib/stripe/client";
import { checkAnswerRules } from "@/lib/agents/answer-rules";
import { capturedAnswer, type AgentChunk, cacheKey, deleteCachedAnswer, deleteOtherVersions, loadCachedAnswer, promptVersion, recordStream, saveCachedAnswer } from "./answer-cache";
import { DEMO_QUESTIONS } from "./questions";

config({ path: ".env.local", quiet: true });

const PAUSE_MS = 20_000; // stay under Groq's 8000 tokens a minute

async function main() {
  const db = createDb(process.env.DATABASE_URL);
  const [run] = await db.select().from(seedRuns).where(isNotNull(seedRuns.completedAt)).orderBy(desc(seedRuns.completedAt)).limit(1);
  if (!run) throw new Error("no completed seed run");
  const anchor = Math.floor(run.anchorAt.getTime() / 1000);
  const stripe = createStripeClient(process.env.STRIPE_DEMO_KEY, "STRIPE_DEMO_KEY");
  const version = promptVersion();
  const accountId = run.accountId;
  const refresh = process.argv.includes("--refresh");
  let ran = 0;
  console.log(`prompt version ${version}, removed ${await deleteOtherVersions(db, version)} old answers`);

  if (refresh) for (const question of DEMO_QUESTIONS) await deleteCachedAnswer(db, cacheKey(question, anchor, version));

  // Answers that fail the quality gate are not saved; the second pass tries those once more.
  for (const [pass, question] of [1, 2].flatMap((p) => DEMO_QUESTIONS.map((q) => [p, q] as const))) {
    const key = cacheKey(question, anchor, version);
    if (await loadCachedAnswer(db, key)) {
      if (pass === 1) console.log(`cached   ${question}`);
      continue;
    }
    if (ran++ > 0) await new Promise((r) => setTimeout(r, PAUSE_MS));

    let runOk = false;
    let saved = false;
    const messages: AgentUIMessage[] = [{ id: "q", role: "user", parts: [{ type: "text", text: question }] }];
    const stream = runAgentChat(messages, {
      stripe,
      mode: "demo",
      accountId,
      now: anchor,
      model: agentModel,
      finishModel,
      audit: async (record) => {
        await db.insert(auditLog).values({ accountId, agent: record.agent, tool: record.tool, params: record.params ?? {}, stripeIds: record.stripeIds, result: record.result as object });
      },
      writes: { accountId: accountId, connectionId: null, permissions: null, saveProposal: (proposal) => saveProposal(db, proposal) },
      saveRun: async (r) => {
        runOk = r.status === "ok";
      },
    });
    const recorded = recordStream(stream, {
      runOk: () => runOk,
      save: async (chunks) => {
        await saveCachedAnswer(db, { key, question, anchor, version, chunks });
        saved = true;
      },
    });
    // Printed so a person reads every answer before visitors see it; rerun with --refresh if one is wrong.
    const chunks: AgentChunk[] = [];
    const reader = recorded.getReader();
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) chunks.push(chunk.value);
    const answer = capturedAnswer(chunks);
    const failed = checkAnswerRules(answer).filter((rule) => !rule.pass);
    console.log(
      [
        `${saved ? "saved   " : "rejected"} ${question}`,
        `  ${answer.text.trim().replace(/\n+/g, "\n  ")}`,
        `  Next: ${answer.nextAction?.text ?? "none"}`,
        ...(saved ? [] : [`  ${runOk ? "" : "run error. "}${failed.map((f) => `${f.rule}: ${f.detail}`).join("; ")}`]),
        "",
      ].join("\n"),
    );
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
