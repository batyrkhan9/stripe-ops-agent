import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, signValue, verifySignedValue } from "@/lib/crypto/secret-box";

const SECRET = randomBytes(32).toString("base64");
const KEY = "rk_test_" + "a".repeat(40);

describe("encryptSecret and decryptSecret", () => {
  it("round-trips and never contains the plaintext", () => {
    const sealed = encryptSecret(KEY, SECRET);
    expect(sealed).not.toContain(KEY);
    expect(decryptSecret(sealed, SECRET)).toBe(KEY);
  });

  it("uses a fresh IV every time", () => {
    expect(encryptSecret(KEY, SECRET)).not.toBe(encryptSecret(KEY, SECRET));
  });

  it("fails on tampered ciphertext", () => {
    const parts = encryptSecret(KEY, SECRET).split(".");
    const flipped = parts[3]!.startsWith("A") ? "B" + parts[3]!.slice(1) : "A" + parts[3]!.slice(1);
    expect(() => decryptSecret([...parts.slice(0, 3), flipped].join("."), SECRET)).toThrow();
  });

  it("fails with a different encryption secret", () => {
    expect(() => decryptSecret(encryptSecret(KEY, SECRET), randomBytes(32).toString("base64"))).toThrow();
  });

  it("requires a 32 byte secret", () => {
    expect(() => encryptSecret(KEY, undefined)).toThrow(/32 bytes/);
    expect(() => encryptSecret(KEY, randomBytes(16).toString("base64"))).toThrow(/32 bytes/);
  });
});

describe("signValue and verifySignedValue", () => {
  const session = "session-secret";

  it("returns the value for a valid signature", () => {
    expect(verifySignedValue(signValue("conn-123", session), session)).toBe("conn-123");
  });

  it("rejects a changed value, a changed signature, or another secret", () => {
    const signed = signValue("conn-123", session);
    expect(verifySignedValue(signed.replace("conn-123", "conn-124"), session)).toBeUndefined();
    expect(verifySignedValue(signed.slice(0, -1) + (signed.endsWith("A") ? "B" : "A"), session)).toBeUndefined();
    expect(verifySignedValue(signed, "other-secret")).toBeUndefined();
  });

  it("rejects missing or unsigned input", () => {
    expect(verifySignedValue(undefined, session)).toBeUndefined();
    expect(verifySignedValue("conn-123", session)).toBeUndefined();
    expect(verifySignedValue(signValue("conn-123", session), undefined)).toBeUndefined();
  });
});
