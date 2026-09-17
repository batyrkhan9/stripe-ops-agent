import { describe, expect, it } from "vitest";
import { assertTestKey, isTestKey, resolveSeedKey } from "@/lib/stripe/keys";

const SEED = "sk_test_seed123";
const DEMO = "rk_test_demo456";

describe("isTestKey", () => {
  it("accepts secret and restricted test keys", () => {
    expect(isTestKey(SEED)).toBe(true);
    expect(isTestKey(DEMO)).toBe(true);
  });

  it("rejects non-test keys", () => {
    expect(isTestKey("sk_" + "live_abc")).toBe(false);
    expect(isTestKey("rk_" + "live_abc")).toBe(false);
    expect(isTestKey("pk_test_abc")).toBe(false);
    expect(isTestKey("")).toBe(false);
  });
});

describe("assertTestKey", () => {
  it("throws when missing", () => {
    expect(() => assertTestKey(undefined, "STRIPE_DEMO_KEY")).toThrow("STRIPE_DEMO_KEY is not set");
  });

  it("never includes the key value in the error", () => {
    const bad = "sk_" + "live_secretvalue";
    expect(() => assertTestKey(bad, "STRIPE_DEMO_KEY")).toThrow(/must be a Stripe test key/);
    try {
      assertTestKey(bad, "STRIPE_DEMO_KEY");
    } catch (error) {
      expect((error as Error).message).not.toContain("secretvalue");
    }
  });
});

describe("resolveSeedKey", () => {
  it("returns the seed key when valid and distinct from the demo key", () => {
    expect(resolveSeedKey({ STRIPE_SEED_KEY: SEED, STRIPE_DEMO_KEY: DEMO })).toBe(SEED);
  });

  it("refuses to run with the demo key", () => {
    expect(() => resolveSeedKey({ STRIPE_SEED_KEY: DEMO, STRIPE_DEMO_KEY: DEMO })).toThrow(
      /refuses to run with the demo key/,
    );
  });

  it("refuses a missing or non-test seed key", () => {
    expect(() => resolveSeedKey({ STRIPE_DEMO_KEY: DEMO })).toThrow("STRIPE_SEED_KEY is not set");
    expect(() => resolveSeedKey({ STRIPE_SEED_KEY: "sk_" + "live_x", STRIPE_DEMO_KEY: DEMO })).toThrow(
      /must be a Stripe test key/,
    );
  });
});
