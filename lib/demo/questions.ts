// The questions whose demo-mode answers are cached. There is no usage data yet, so they come from the
// discovery clusters (disputes, failed payments, rates) rather than from logs. The chat page offers them
// as examples, which steers most demo traffic onto cached answers.
export const DEMO_QUESTIONS = [
  "Which disputes need a response?",
  "Why did payments fail in the last 7 days?",
  "What is our dispute rate over the last 30 days?",
  "Which subscriptions are past due?",
  "Which invoices failed and why?",
  "Which dispute is due soonest?",
  "How much revenue did we collect in the last 30 days?",
  "How many refunds did we issue in the last 30 days?",
  "How many active subscriptions do we have?",
  "What is our current balance?",
] as const;

// Lowercase, letters and digits only, single spaces. "Which disputes need a response" matches
// "which disputes need a response?" but not a reworded question.
export function normalizeQuestion(question: string): string {
  return question
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const BY_NORMALIZED = new Map<string, string>(DEMO_QUESTIONS.map((q) => [normalizeQuestion(q), q]));

export function matchDemoQuestion(question: string): string | null {
  return BY_NORMALIZED.get(normalizeQuestion(question)) ?? null;
}
