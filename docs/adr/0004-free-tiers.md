# ADR 0004: Run entirely on free tiers, and design around their limits

Status: accepted, 2026-09-17

## Context

This is a public portfolio demo with no budget. Every service must be free, and the demo must keep working
when a recruiter clicks in on a day the limits are already used up. The limits we actually hit on 2026-09-17:

| Service | Free tier limit that mattered | What we saw |
|---|---|---|
| Gemini 3.5 Flash | 20 requests a day per model | About 4 chat answers, then 429 for the rest of the day |
| Groq gpt-oss-120b and 20b | 1,000 requests a day, 8,000 tokens a minute, 200,000 tokens a day per model | A 9,489 token request failed with 413; the daily token limit ran out after roughly 20 agent answers |
| Groq qwen3.8-27b | 1,000 requests a day, 8,000 tokens a minute | Used only by the benchmark |
| Gemini 3.5 and 3.1 Flash Lite | Separate quota per model | Used as fallbacks and for forced tool calls |
| Neon Postgres, Vercel Hobby, Stripe test mode | Storage, function duration (60s chat route) | No limit reached |

## Decision

- Models: one ordered chain in `lib/llm/provider.ts` (Groq gpt-oss-120b, gpt-oss-20b, Gemini 3.5 Flash Lite,
  Gemini 3.1 Flash Lite). A call moves to the next model on 429, 413, 5xx, or a network error. Each model has
  its own quota, so the chain multiplies what a day allows. The forced `finish_answer` call starts with Gemini
  Flash Lite, which returned valid tool arguments where gpt-oss-20b did not.
- Keep requests small: list tools return at most 25 rows with totals over every match, chat history is capped
  at 6 messages, a specialist gets at most 6 steps, and tools return labels ("$195.00", "due Sep 25, in 8 days")
  instead of raw objects.
- Cache what repeats: answers to the 10 example questions on the demo account are stored and replayed
  (keyed by prompt version and demo date, stored only if they pass every format rule). Eval judge verdicts are
  cached by a hash of question plus answer.
- Limit what visitors can trigger: AI drafts and the analytics narrative are made on a button press, stored, and
  redrafted at most once an hour per object on the demo account.
- Evals are resumable. A run stops after 5 rate-limited cases in a row and continues from where it stopped, so
  a benchmark can span several days of quota. The README reports how many cases each model finished.
- No paid service, ever, without asking. If a limit blocks progress, switch models in `provider.ts` and log it in
  the changelog.

## Alternatives considered

- A paid tier on one provider. Ruled out by CLAUDE.md, and it would hide the reliability work a free demo needs.
- One model everywhere. Any single free model runs out within a day of testing.
- Local models. Not deployable on Vercel's free tier.

## Consequences

- Answers can come from different models within one chat, so quality varies; traces record which model served
  each call, and evals report pass rates per model.
- A full eval run cannot finish in one day on Groq alone. Partial results are labeled as partial.
- Model IDs and limits change often. The chain and this table need a check whenever answers start failing.
