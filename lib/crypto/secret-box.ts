import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// AES-256-GCM for merchant keys at rest. Format: v1.<iv>.<tag>.<ciphertext>, base64url parts.
function encryptionKey(secret: string | undefined): Buffer {
  const key = secret ? Buffer.from(secret, "base64") : Buffer.alloc(0);
  if (key.length !== 32) {
    throw new Error("KEY_ENCRYPTION_SECRET must be 32 bytes, base64 encoded");
  }
  return key;
}

export function encryptSecret(plaintext: string, secret: string | undefined): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv, cipher.getAuthTag(), ciphertext].map((part) => (typeof part === "string" ? part : part.toString("base64url"))).join(".");
}

export function decryptSecret(sealed: string, secret: string | undefined): string {
  const [version, iv, tag, ciphertext] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || !ciphertext) {
    throw new Error("unrecognized sealed secret format");
  }
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(secret), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}

// HMAC-signed cookie values: <value>.<signature>. Returns the value only if the signature matches.
export function signValue(value: string, secret: string | undefined): string {
  if (!secret) throw new Error("SESSION_SECRET is not set");
  return `${value}.${createHmac("sha256", secret).update(value).digest("base64url")}`;
}

export function verifySignedValue(signed: string | undefined, secret: string | undefined): string | undefined {
  if (!signed || !secret) return undefined;
  const dot = signed.lastIndexOf(".");
  if (dot <= 0) return undefined;
  const value = signed.slice(0, dot);
  const expected = Buffer.from(signValue(value, secret));
  const actual = Buffer.from(signed);
  return expected.length === actual.length && timingSafeEqual(expected, actual) ? value : undefined;
}
