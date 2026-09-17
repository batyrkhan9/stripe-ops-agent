import { google } from "@ai-sdk/google";
import { groq } from "@ai-sdk/groq";
import type { LanguageModelV4 } from "@ai-sdk/provider";

// The only file that chooses models. Tried in order; each model has its own free tier quota.
// 2026-09-17: switched the primary from Gemini to Groq. gemini-3.5-flash's free tier allows 20 requests a
// day per model (quota GenerateRequestsPerDayPerProjectPerModel-FreeTier), about 4 chat answers. Groq allows
// 1000 requests a day and 8000 tokens a minute per model. All four passed a tool-calling probe.
export const MODEL_CHAIN = [
  { provider: "groq", modelId: "openai/gpt-oss-120b" },
  { provider: "groq", modelId: "openai/gpt-oss-20b" },
  { provider: "google", modelId: "gemini-3.5-flash-lite" },
  { provider: "google", modelId: "gemini-3.1-flash-lite" },
] as const;

// Passed on every call. Each provider reads only its own key.
export const PROVIDER_OPTIONS = { groq: { reasoningEffort: "low" } } as const;

export type ServedBy = { provider: string; modelId: string; fellBack: boolean; failures: string[] };

// Rate limits (429), requests too large for one model's per-minute token limit (413), server errors (5xx),
// and network failures move to the next model. Other client errors do not: the next model would fail the same way.
// 413 was added after a 9489 token request failed on Groq's 8000 tokens a minute limit (evals/format-results.md).
export function shouldFallBack(error: unknown): boolean {
  const status = (error as { statusCode?: number }).statusCode;
  if (status === undefined) return error instanceof Error && error.name !== "AbortError";
  return status === 429 || status === 413 || status >= 500;
}

export function createFallbackModel(models: readonly LanguageModelV4[], onServed: (served: ServedBy) => void = () => {}): LanguageModelV4 {
  if (models.length === 0) throw new Error("createFallbackModel needs at least one model");

  async function call<T>(run: (model: LanguageModelV4) => PromiseLike<T>): Promise<T> {
    const failures: string[] = [];
    for (const [index, model] of models.entries()) {
      try {
        const result = await run(model);
        onServed({ provider: model.provider, modelId: model.modelId, fellBack: index > 0, failures });
        return result;
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        failures.push(`${model.modelId}: ${status ? `HTTP ${status}` : "network error"}`);
        if (!shouldFallBack(error) || index === models.length - 1) throw error;
      }
    }
    throw new Error("unreachable");
  }

  return {
    specificationVersion: "v4",
    provider: "fallback-chain",
    modelId: models[0]!.modelId,
    supportedUrls: {},
    doGenerate: (options) => call((model) => model.doGenerate(options)),
    doStream: (options) => call((model) => model.doStream(options)),
  };
}

// The finish step makes one forced tool call. gpt-oss-20b returned unparseable tool arguments there, so it
// starts with Gemini Flash Lite, which has its own quota.
export const FINISH_CHAIN = [MODEL_CHAIN[2], MODEL_CHAIN[0], MODEL_CHAIN[3], MODEL_CHAIN[1]] as const;

type ChainEntry = (typeof MODEL_CHAIN)[number];
const build = (chain: readonly ChainEntry[]) => chain.map((m) => (m.provider === "groq" ? groq(m.modelId) : google(m.modelId)));

export function agentModel(onServed?: (served: ServedBy) => void): LanguageModelV4 {
  return createFallbackModel(build(MODEL_CHAIN), onServed);
}

export function finishModel(onServed?: (served: ServedBy) => void): LanguageModelV4 {
  return createFallbackModel(build(FINISH_CHAIN), onServed);
}

// Models the eval benchmark runs one at a time, with no fallback, so each row measures a single model
// (evals/run.ts). qwen3.8-27b is the third free model: a different family from gpt-oss and Gemini on Groq's free tier.
export const BENCHMARK_MODELS = {
  "gpt-oss-120b": { provider: "groq", modelId: "openai/gpt-oss-120b" },
  "gemini-3.5-flash-lite": { provider: "google", modelId: "gemini-3.5-flash-lite" },
  "qwen3.8-27b": { provider: "groq", modelId: "qwen/qwen3.8-27b" },
} as const;

export type BenchmarkModel = keyof typeof BENCHMARK_MODELS;

export function singleModel(name: BenchmarkModel) {
  const entry = BENCHMARK_MODELS[name];
  return (onServed?: (served: ServedBy) => void): LanguageModelV4 =>
    createFallbackModel([entry.provider === "groq" ? groq(entry.modelId) : google(entry.modelId)], onServed);
}
