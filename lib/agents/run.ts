import type { LanguageModelV4 } from "@ai-sdk/provider";
import {
  convertToModelMessages,
  createUIMessageStream,
  isStepCount,
  isTextUIPart,
  streamText,
  tool,
  toUIMessageStream,
  type ToolSet,
} from "ai";
import type Stripe from "stripe";
import { PROVIDER_OPTIONS, type ServedBy } from "@/lib/llm/provider";
import { READ_TOOLS, type ReadToolName } from "@/lib/tools/read";
import { executeReadTool, type AuditRecord, type ToolContext } from "@/lib/tools/types";
import type { Span } from "@/lib/trace/recorder";
import { TraceRecorder } from "@/lib/trace/recorder";
import { planRoute, type Plan } from "./planner/plan";
import { SPECIALISTS } from "./registry";
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
  audit: (record: AuditRecord) => Promise<void>;
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

export function buildTools(names: readonly ReadToolName[], ctx: ToolContext): ToolSet {
  return Object.fromEntries(
    names.map((name) => {
      const definition = READ_TOOLS[name];
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

export function lastUserText(messages: AgentUIMessage[]): string {
  const last = [...messages].reverse().find((m) => m.role === "user");
  return (last?.parts ?? []).filter(isTextUIPart).map((p) => p.text).join("\n").trim();
}

export function runAgentChat(messages: AgentUIMessage[], deps: RunDeps) {
  const question = lastUserText(messages);
  const trace = new TraceRecorder();
  const toolIds = new Set<string>();
  const toolsCalled: string[] = [];
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

          const ctx: ToolContext = {
            stripe: deps.stripe,
            agent,
            now: deps.now,
            audit: deps.audit,
            onToolResult: (result) => {
              result.stripeIds.forEach((id) => toolIds.add(id));
              toolsCalled.push(result.tool);
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

          const result = streamText({
            model: deps.model((s) => {
              served = s;
              writer.write({ type: "data-served", data: s, transient: true });
            }),
            instructions: `${specialist.prompt}\n\n${sharedRules({ now: deps.now, mode: deps.mode })}`,
            messages: modelMessages,
            tools: buildTools(specialist.tools, ctx),
            stopWhen: isStepCount(5),
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

          writer.merge(toUIMessageStream({ stream: result.stream, sendStart: false, sendFinish: false }));
          const text = await result.text;
          answer += `${text}\n`;
          specialistSpan.end({ provider: served?.provider, modelId: served?.modelId, output: { chars: text.length } });
        }
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
      }

      sources = buildSources(answer, toolIds, toolsCalled);
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
