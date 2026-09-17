const TEST_KEY_PREFIXES = ["sk_test_", "rk_test_"] as const;

export function isTestKey(key: string): boolean {
  return TEST_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

// Error messages name the env var, never the key value.
export function assertTestKey(key: string | undefined, name: string): string {
  if (!key) {
    throw new Error(`${name} is not set`);
  }
  if (!isTestKey(key)) {
    throw new Error(`${name} must be a Stripe test key (sk_test_ or rk_test_)`);
  }
  return key;
}

export function resolveSeedKey(env: {
  STRIPE_SEED_KEY?: string;
  STRIPE_DEMO_KEY?: string;
}): string {
  const seedKey = assertTestKey(env.STRIPE_SEED_KEY, "STRIPE_SEED_KEY");
  if (seedKey === env.STRIPE_DEMO_KEY) {
    throw new Error("STRIPE_SEED_KEY equals STRIPE_DEMO_KEY. The seed script refuses to run with the demo key.");
  }
  return seedKey;
}
