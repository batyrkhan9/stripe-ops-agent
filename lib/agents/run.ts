import type { LanguageModelV4 } from "@ai-sdk/provider";
import {
  convertToModelMessages,
  createUIMessageStream,
  generateText,
  isStepCount,
  isTextUIPart,
  streamText,
  tool,
  toUIMessageStream,
  type ToolSet,
} from "ai";
import type Stripe from "stripe";
import { proposeWrite, type ProposeContext, type ProposeOutput } from "@/lib/actions/propose";
import { PROVIDER_OPTIONS, type ServedBy } from "@/lib/llm/provider";
import { CARD_PAGE, PAGES, type Card, type CardsOutput, type NextAction } from "@/lib/cards/types";
import { PRESENT_TOOLS } from "@/lib/tools/present";
import { alertRulesForQuestion } from "@/lib/tools/present/show-alerts";
import { READ_TOOLS } from "@/lib/tools/read";
import { isWriteToolName, WRITE_TOOLS } from "@/lib/tools/write";
import { executeReadTool, type AuditRecord, type ToolContext } from "@/lib/tools/types";
import type { Span } from "@/lib/trace/recorder";
import { TraceRecorder } from "@/lib/trace/recorder";
import { FINISH_PROMPT } from "./finish/prompt";
import { planRoute, type Plan } from "./planner/plan";
import { SPECIALISTS, type AgentToolName } from "./registry";
import { sharedRules } from "./rules";
import { buildSources, type Sources } from "./sources";
import type { AgentUIMessage } from "./ui-types";

export type RunDeps = {
  stripe: Stripe;
  mode: "demo" | "connected";
  accountId: string;
  now: number;
  // Returns a model that reports which provider served each call.
  model: (onServed: (served: ServedBy) => void) => LanguageModelV4;
  // Model for the forced finish_answer call. Defaults to model.
  finishModel?: (onServed: (served: ServedBy) => void) => LanguageModelV4;
  audit: (record: AuditRecord) => Promise<void>;
  // Where write tool calls store their proposals (ADR 0003). Nothing in here can execute a write.
  writes: Pick<ProposeContext, "accountId" | "connectionId" | "permissions" | "saveProposal">;
  saveRun: (run: {
    runId: string;
    accountId: string;
    question: string;
    plan: Plan | null;
    status: "ok" | "error";
    error?: string;
    latencyMs: number;
    sources: Sources | null;
    spans: Span[];
  }) => Promise<void>;
};

// Groq's free tier allows 8000 tokens a minute per model, so history and steps are kept short.
const MAX_HISTORY = 6;
const MAX_STEPS = 6;

const ALL_TOOLS = { ...READ_TOOLS, ...PRESENT_TOOLS };

type WriteBinding = Omit<ProposeContext, "stripe" | "now" | "agent" | "audit">;

export function buildTools(names: readonly AgentToolName[], ctx: ToolContext, writes?: WriteBinding): ToolSet {
  return Object.fromEntries(
    names.map((name) => {
      if (isWriteToolName(name)) {
        const definition = WRITE_TOOLS[name];
        return [
          name,
          tool({
            description: definition.description,
            inputSchema: definition.input,
            // Proposes only. With no write binding the call is refused, so a misconfigured run cannot write either.
            execute: async (input: unknown) => {
              const started = Date.now();
              const output: ProposeOutput = writes
                ? await proposeWrite(definition, input, { ...writes, stripe: ctx.stripe, now: ctx.now, agent: ctx.agent, audit: ctx.audit })
                : { status: "refused", reason: "read_only_key", message: "Writes are not available here." };
              ctx.onToolResult?.({ tool: name, params: input, output, stripeIds: output.status === "proposed" ? output.target_ids : [], ok: output.status === "proposed", ms: Date.now() - started });
              return output;
            },
          }),
        ];
      }
      const definition = ALL_TOOLS[name];
      return [
        name,
        tool({
          description: definition.description,
          inputSchema: definition.input,
          execute: (input: unknown) => executeReadTool(definition, input, ctx),
        }),
      ];
    }),
  );
}

export function actionCard(proposal: Extract<ProposeOutput, { status: "proposed" }>): Card {
  return {
    kind: "action",
    id: proposal.proposal_id,
    title: proposal.summary,
    amount: "",
    status: proposal.demo ? "Demo, cannot be confirmed" : "Waiting for confirmation",
    details: proposal.details,
    note: proposal.demo ? "Nothing changed. The demo account is read-only." : "Nothing has changed yet.",
    urgent: false,
    action: { label: "Review and confirm", href: `/actions?proposal=${proposal.proposal_id}#${proposal.proposal_id}` },
  };
}

const OPEN_DISPUTE = /needs_response|under_review/;
const UNPAID_INVOICE = new Set(["open", "uncollectible"]);
const PAST_DUE = new Set(["past_due", "unpaid"]);

// Picks the objects a specialist looked up that should render as cards: open disputes, and open invoices
// or the latest invoices of past-due subscriptions.
export function cardIdsFrom(kind: "disputes" | "invoices", tool: string, output: unknown): string[] {
  const data = output as Record<string, unknown> | null;
  if (!data || typeof data !== "object") return [];
  if (kind === "disputes") {
    if (tool === "list_disputes") {
      return ((data.disputes as { id: string; status: string }[]) ?? []).filter((d) => OPEN_DISPUTE.test(d.status)).map((d) => d.id);
    }
    if (tool === "get_dispute" && typeof data.id === "string" && OPEN_DISPUTE.test(String(data.status))) return [data.id];
    return [];
  }
  if (tool === "list_invoices") {
    return ((data.invoices as { id: string; status: string }[]) ?? []).filter((i) => UNPAID_INVOICE.has(i.status)).map((i) => i.id);
  }
  if (tool === "list_subscriptions") {
    return ((data.subscriptions as { status: string; latest_invoice: unknown }[]) ?? [])
      .filter((sub) => PAST_DUE.has(sub.status))
      .flatMap((sub) => {
        const invoice = sub.latest_invoice as { id?: string; status?: string } | string | null;
        if (invoice && typeof invoice === "object" && invoice.id && UNPAID_INVOICE.has(invoice.status ?? "")) return [invoice.id];
        return [];
      });
  }
  return [];
}

export function lastUserText(messages: AgentUIMessage[]): string {
  const last = [...messages].reverse().find((m) => m.role === "user");
  return (last?.parts ?? []).filter(isTextUIPart).map((p) => p.text).join("\n").trim();
}

export function runAgentChat(messages: AgentUIMessage[], deps: RunDeps) {
  const question = lastUserText(messages);
  const trace = new TraceRecorder();
  const toolIds = new Set<string>();
  const toolsCalled: string[] = [];
  const cardIds: string[] = [];
  let shownCardKind: Card["kind"] | null = null;
  const writeBinding: WriteBinding = { ...deps.writes, mode: deps.mode };
  const declaredIds: string[] = [];
  let plan: Plan | null = null;
  let sources: Sources | null = null;
  let failure: string | undefined;

  return createUIMessageStream<AgentUIMessage>({
    onError: (error) => {
      failure = error instanceof Error ? error.message : String(error);
      return "The AI providers are busy or rate limited right now. Please try again in a minute.";
    },
    execute: async ({ writer }) => {
      writer.write({ type: "start" });
      const modelMessages = await convertToModelMessages(messages.slice(-MAX_HISTORY));

      const plannerSpan = trace.start("planner", "planner", { input: { question } });
      let plannerServed: ServedBy | undefined;
      plan = await planRoute(deps.model((s) => (plannerServed = s)), modelMessages, question);
      plannerSpan.end({ output: plan, provider: plannerServed?.provider, modelId: plannerServed?.modelId, error: plan.error });
      writer.write({ type: "data-plan", data: { agents: plan.agents, reason: plan.reason, source: plan.source } });

      let answer = "";
      try {
        for (const agent of plan.agents) {
          const specialist = SPECIALISTS[agent];
          const specialistSpan = trace.start("specialist", agent, { parentId: plannerSpan.id });
          let served: ServedBy | undefined;
          let llmStarted = Date.now();

          const cardSource: string[] = [];
          const proposalCards: Card[] = [];
          const ctx: ToolContext = {
            stripe: deps.stripe,
            agent,
            now: deps.now,
            audit: deps.audit,
            onToolResult: (result) => {
              toolsCalled.push(result.tool);
              result.stripeIds.forEach((id) => toolIds.add(id));
              if (result.ok && isWriteToolName(result.tool)) {
                const proposal = result.output as Extract<ProposeOutput, { status: "proposed" }>;
                proposalCards.push(actionCard(proposal));
                cardIds.push(...proposal.target_ids);
              }
              if (result.ok && (specialist.cards === "disputes" || specialist.cards === "invoices")) {
                cardSource.push(...cardIdsFrom(specialist.cards, result.tool, result.output));
              }
              trace.record("tool", result.tool, {
                parentId: specialistSpan.id,
                input: result.params,
                output: { ok: result.ok, stripeIds: result.stripeIds },
                latencyMs: result.ms,
                error: result.ok ? undefined : "tool returned an error",
              });
            },
          };

          if (plan.agents.length > 1) writer.write({ type: "data-section", data: { agent } });

          const runSpecialist = () => streamText({
            model: deps.model((s) => {
              served = s;
              writer.write({ type: "data-served", data: s, transient: true });
            }),
            instructions: `${specialist.prompt}\n\n${sharedRules({ now: deps.now, mode: deps.mode })}`,
            messages: modelMessages,
            tools: buildTools(specialist.tools, ctx, writeBinding),
            stopWhen: isStepCount(MAX_STEPS),
            // The last step cannot call tools, so the specialist always ends with an answer.
            prepareStep: ({ stepNumber }) => (stepNumber >= MAX_STEPS - 1 ? { toolChoice: "none" as const } : undefined),
            maxOutputTokens: 1500,
            maxRetries: 0,
            providerOptions: PROVIDER_OPTIONS,
            onLanguageModelCallStart: () => {
              llmStarted = Date.now();
            },
            onLanguageModelCallEnd: (event) => {
              trace.record("llm", `${agent} model call`, {
                parentId: specialistSpan.id,
                provider: served?.provider,
                modelId: served?.modelId,
                inputTokens: event.usage.inputTokens,
                outputTokens: event.usage.outputTokens,
                output: { finishReason: event.finishReason, fellBack: served?.fellBack, failures: served?.failures },
                latencyMs: Date.now() - llmStarted,
              });
            },
          });

          // A provider error after streaming starts cannot fall back to the next model, so a specialist that
          // fails before writing any text is retried once.
          let text = "";
          for (let attempt = 1; attempt <= 2; attempt++) {
            const result = runSpecialist();
            writer.merge(toUIMessageStream({ stream: result.stream, sendStart: false, sendFinish: false }));
            try {
              text = await result.text;
              break;
            } catch (error) {
              if (attempt === 2 || text) throw error;
              trace.record("specialist", `${agent} retry`, { parentId: specialistSpan.id, latencyMs: 0, error: error instanceof Error ? error.message.slice(0, 300) : String(error) });
            }
          }
          answer += `${text}\n`;

          // Cards are built by code from what the specialist looked up. Asking the model to call show_* tools
          // was unreliable: gpt-oss wrote the calls into the answer as text (evals/format-results.md).
          if (proposalCards.length) {
            // Proposals come first: they are what the merchant asked for.
            shownCardKind ??= "action";
            writer.write({ type: "data-cards", data: { cards: proposalCards } });
          }
          const ids = [...new Set(cardSource)].slice(0, 10);
          const alertRules = specialist.cards === "alerts" ? alertRulesForQuestion(question) : [];
          if (alertRules.length) {
            // Alert cards come from the same rules as the dashboard, for rate, refund, and decline questions.
            const output = (await executeReadTool(PRESENT_TOOLS.show_alerts, { rules: alertRules }, { ...ctx, agent: `${agent}:cards` })) as {
              cards?: Card[];
              stripe_ids?: string[];
            };
            if (output.cards?.length) {
              cardIds.push(...(output.stripe_ids ?? []));
              shownCardKind ??= "alert";
              writer.write({ type: "data-cards", data: { cards: output.cards } });
            }
          } else if ((specialist.cards === "disputes" || specialist.cards === "invoices") && ids.length) {
            const definition = specialist.cards === "disputes" ? PRESENT_TOOLS.show_disputes : PRESENT_TOOLS.show_invoices;
            const input = specialist.cards === "disputes" ? { dispute_ids: ids } : { invoice_ids: ids };
            const output = (await executeReadTool(definition, input, { ...ctx, agent: `${agent}:cards` })) as Partial<CardsOutput>;
            const cards = output.cards ?? [];
            if (cards.length) {
              cardIds.push(...cards.map((card) => card.id));
              shownCardKind ??= cards[0]!.kind;
              writer.write({ type: "data-cards", data: { cards } });
            }
          }
          specialistSpan.end({ provider: served?.provider, modelId: served?.modelId, output: { chars: text.length, cards: ids.length } });
        }
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
      }

      // The next action comes from a separate forced tool call. Asking the specialist to call finish_answer
      // itself failed: gpt-oss wrote the call into the answer as text instead (evals/format-results.md).
      if (answer.trim()) {
        const finishSpan = trace.start("specialist", "finish", { parentId: plannerSpan.id });
        let finished = false;
        let finishServed: ServedBy | undefined;
        const ctx: ToolContext = {
          stripe: deps.stripe,
          agent: "finish",
          now: deps.now,
          audit: deps.audit,
          onToolResult: (result) => {
            toolsCalled.push(result.tool);
            if (!result.ok) return;
            const output = result.output as NextAction & { source_ids: string[] };
            // Declared IDs are bookkeeping for Sources, not claims in the answer. Keep only IDs a tool returned;
            // the model sometimes mistypes one character of a real ID.
            declaredIds.push(...output.source_ids.filter((id) => toolIds.has(id)));
            // When cards were shown, the next action happens on their page, whatever the model picked.
            const cardPage = shownCardKind ? CARD_PAGE[shownCardKind] : null;
            const page = cardPage ?? output.page;
            const button = page ? { label: PAGES[page].label, href: PAGES[page].href } : null;
            writer.write({ type: "data-next", data: { text: output.text, page, button } });
            finished = true;
          },
        };
        // Capped at 25 with a larger output budget: echoing 60 IDs cut the call off mid-arguments, which showed up as
        // "no tool call" on Gemini and invalid JSON on gpt-oss (format-04 in evals/format-results.md).
        const ids = [...new Set([...cardIds, ...toolIds])].slice(0, 25);
        // Retried once on the other chain: gpt-oss-20b occasionally returns tool arguments that are not valid JSON,
        // and Gemini Flash Lite once answered without the forced call (evals/format-results.md).
        for (let attempt = 1; attempt <= 2 && !finished; attempt++) try {
          const chain = attempt === 1 ? (deps.finishModel ?? deps.model) : deps.model;
          await generateText({
            model: chain((s) => (finishServed = s)),
            instructions: FINISH_PROMPT,
            prompt: `Question: ${question}\n\nAnswer:\n${answer.trim()}\n\nStripe IDs returned by tools${cardIds.length ? " (shown as cards first)" : ""}: ${ids.join(", ") || "none"}`,
            tools: buildTools(["finish_answer"], ctx),
            toolChoice: { type: "tool", toolName: "finish_answer" },
            stopWhen: isStepCount(1),
            maxOutputTokens: 1500,
            maxRetries: 0,
            providerOptions: PROVIDER_OPTIONS,
          });
          if (finished) finishSpan.end({ provider: finishServed?.provider, modelId: finishServed?.modelId, output: { attempt } });
          else if (attempt === 2) finishSpan.end({ error: "finish_answer returned invalid input twice" });
        } catch (error) {
          if (attempt === 2) finishSpan.end({ error: error instanceof Error ? error.message.slice(0, 300) : String(error) });
        }
      }

      // With cards or proposals shown, Sources cite exactly their objects. The finish model's declared IDs are used
      // only for freeform answers: it once cited a different charge of the same customer than the refund proposed.
      sources = buildSources({ answer, toolIds, toolsCalled, cardIds, declaredIds: cardIds.length ? [] : declaredIds });
      writer.write({ type: "data-sources", data: sources });
      writer.write({ type: "finish" });
    },
    onEnd: async () => {
      await deps
        .saveRun({
          runId: trace.runId,
          accountId: deps.accountId,
          question,
          plan,
          status: failure ? "error" : "ok",
          error: failure,
          latencyMs: trace.elapsedMs(),
          sources,
          spans: trace.spans,
        })
        .catch((error: unknown) => console.error("trace save failed", error));
    },
  });
}
