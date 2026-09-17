import type { LanguageModelV4, LanguageModelV4CallOptions } from "@ai-sdk/provider";
import { describe, expect, it, vi } from "vitest";
import { createFallbackModel, MODEL_CHAIN, shouldFallBack, type ServedBy } from "@/lib/llm/provider";

const httpError = (statusCode: number) => Object.assign(new Error(`HTTP ${statusCode}`), { statusCode });

function fakeModel(provider: string, behavior: "ok" | Error): LanguageModelV4 {
  const run = vi.fn(async () => {
    if (behavior instanceof Error) throw behavior;
    return { served: provider } as never;
  });
  return { specificationVersion: "v4", provider, modelId: `${provider}-model`, supportedUrls: {}, doGenerate: run, doStream: run };
}

const options = {} as LanguageModelV4CallOptions;

describe("shouldFallBack", () => {
  it("falls back on rate limits, server errors, and network failures", () => {
    expect(shouldFallBack(httpError(429))).toBe(true);
    expect(shouldFallBack(httpError(500))).toBe(true);
    expect(shouldFallBack(httpError(503))).toBe(true);
    expect(shouldFallBack(new Error("fetch failed"))).toBe(true);
  });

  it("does not fall back on client errors or aborts", () => {
    expect(shouldFallBack(httpError(400))).toBe(false);
    expect(shouldFallBack(httpError(404))).toBe(false);
    expect(shouldFallBack(Object.assign(new Error("aborted"), { name: "AbortError" }))).toBe(false);
  });
});

describe("createFallbackModel", () => {
  it("uses the first model when it works", async () => {
    const served: ServedBy[] = [];
    const second = fakeModel("groq-20b", "ok");
    const model = createFallbackModel([fakeModel("groq-120b", "ok"), second], (s) => served.push(s));
    await expect(model.doGenerate(options)).resolves.toEqual({ served: "groq-120b" });
    expect(second.doGenerate).not.toHaveBeenCalled();
    expect(served).toEqual([{ provider: "groq-120b", modelId: "groq-120b-model", fellBack: false, failures: [] }]);
  });

  it("moves down the chain on 429 and 503, for generate and stream", async () => {
    const served: ServedBy[] = [];
    const model = createFallbackModel(
      [fakeModel("groq-120b", httpError(429)), fakeModel("groq-20b", httpError(503)), fakeModel("gemini-lite", "ok")],
      (s) => served.push(s),
    );
    await expect(model.doGenerate(options)).resolves.toEqual({ served: "gemini-lite" });
    await expect(model.doStream(options)).resolves.toEqual({ served: "gemini-lite" });
    expect(served[0]).toEqual({
      provider: "gemini-lite",
      modelId: "gemini-lite-model",
      fellBack: true,
      failures: ["groq-120b-model: HTTP 429", "groq-20b-model: HTTP 503"],
    });
  });

  it("rethrows a client error without trying the next model", async () => {
    const second = fakeModel("groq-20b", "ok");
    const model = createFallbackModel([fakeModel("groq-120b", httpError(400)), second]);
    await expect(model.doGenerate(options)).rejects.toThrow("HTTP 400");
    expect(second.doGenerate).not.toHaveBeenCalled();
  });

  it("surfaces the last error when every model fails", async () => {
    const model = createFallbackModel([fakeModel("a", httpError(429)), fakeModel("b", httpError(503))]);
    await expect(model.doGenerate(options)).rejects.toThrow("HTTP 503");
  });

  it("refuses an empty chain", () => {
    expect(() => createFallbackModel([])).toThrow();
  });
});

describe("MODEL_CHAIN", () => {
  it("starts with Groq and keeps Gemini as a fallback, never the 20 requests a day model", () => {
    expect(MODEL_CHAIN[0]).toEqual({ provider: "groq", modelId: "openai/gpt-oss-120b" });
    expect(MODEL_CHAIN.some((m) => m.provider === "google")).toBe(true);
    expect(MODEL_CHAIN.map((m) => m.modelId)).not.toContain("gemini-3.5-flash");
  });
});
