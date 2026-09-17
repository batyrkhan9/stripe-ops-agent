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

// Rate limits (429), server errors (5xx), and network failures with no status move to the next model.
// Other client errors (4xx) do not, because the next model would fail the same way.
export function shouldFallBack(error: unknown): boolean {
  const status = (error as { statusCode?: number }).statusCode;
  if (status === undefined) return error instanceof Error && error.name !== "AbortError";
  return status === 429 || status >= 500;
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

export function agentModel(onServed?: (served: ServedBy) => void): LanguageModelV4 {
  return createFallbackModel(
    MODEL_CHAIN.map((m) => (m.provider === "groq" ? groq(m.modelId) : google(m.modelId))),
    onServed,
  );
}
