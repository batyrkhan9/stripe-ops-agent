import { describe, expect, it } from "vitest";
import { assertSpikeAllowed } from "@/lib/stripe/seed/guard";

describe("assertSpikeAllowed", () => {
  it("refuses when SPIKE_ALLOWED_ACCOUNT is not set", () => {
    expect(() => assertSpikeAllowed("acct_demo", undefined)).toThrow(/SPIKE_ALLOWED_ACCOUNT is not set/);
    expect(() => assertSpikeAllowed("acct_demo", "")).toThrow(/SPIKE_ALLOWED_ACCOUNT is not set/);
  });

  it("refuses when the account does not match", () => {
    expect(() => assertSpikeAllowed("acct_demo", "acct_scratch")).toThrow(/does not match/);
  });

  it("allows the named account", () => {
    expect(() => assertSpikeAllowed("acct_scratch", "acct_scratch")).not.toThrow();
  });
});
