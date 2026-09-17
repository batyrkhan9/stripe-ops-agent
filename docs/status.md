# Status, 2026-09-17 (end of unattended session)

Every item in the queue is done except what free tier quotas stopped. Nothing live was touched, no demo
data was deleted, no paid service was added. 194 unit tests pass, CI is green, production pages return 200.
Every decision made without you, with how to reverse it: [decisions-while-away.md](decisions-while-away.md).

## Done

| Item | Result | Where |
|---|---|---|
| Phase 4 analytics | MRR ($945.31), net MRR (+$53.66: +$160.66 new, -$107.00 churned), churn (11.1%, 3 of 27), gross volume, weekly MRR chart, cohort retention, decline rate by brand and country, calculations shown. Pure functions with 10 tests. AI narrative checked number by number against the metrics. Chat gets the same numbers through a new `get_metrics` tool. Live on /analytics. | `lib/analytics/`, `app/analytics/`, [learn](learn/phase-4-analytics.md) |
| 100 eval cases | 15 routing, 20 disputes, 20 recovery, 30 analytics, 15 action proposals. Expected values computed from the demo account. | `evals/cases.json`, `evals/build-cases.ts` |
| 13 safety cases | 10 write-pressure requests, 3 read-only key cases, run against a Stripe client that blocks every write | `evals/safety.json`, `evals/checks.ts` |
| Runner and judge | Resumable by label, saves after every case, waits out per-minute limits, stops after 5 rate-limited cases in a row. LLM judge cached by hash of question and answer. | `evals/run.ts`, `evals/judge.ts`, `evals/judge-cache.json` |
| Eval results | Run 1: 80% of finished cases, safety 12 of 13 (the failure was a grading bug). Fixes, then run 2 on the failures: **88 of 93 finished cases pass (95%)**, safety 12 of 12 finished. 7 cases and 1 safety case not finished. | [evals/results.md](../evals/results.md), [results-run1.md](../evals/results-run1.md) |
| Benchmark | Partial. Gemini 3.5 Flash Lite 84% of 44 finished, qwen3.8-27b 94% of 32, gpt-oss-120b not started (see below). Leaderboard in the README. | [evals/benchmark.md](../evals/benchmark.md) |
| CI | Push: lint, typecheck, tests. Pull request: 13 safety cases (must pass) and 5 sampled cases. Manual dispatch: full suite for a chosen model. | `.github/workflows/ci.yml` |
| README | What it is, live demo, screenshots, eval score, leaderboard, how safety works, stack, how to run, demo data, docs, sources | [README.md](../README.md) |
| docs/workflow.md | Tools, how the build was structured, what was automated, what would change | [workflow.md](workflow.md) |
| ADRs | 0004 free tiers written; 0001, 0002, 0003, 0005 already existed | [adr/](adr/) |

## What the evals found and fixed

- Past-due and failed-payment count questions were routed to analytics. Fixed in the planner prompt and keyword routing.
- A 7 day decline alert card appeared under 30 day and per-brand answers and contradicted them. Cards now match the question's window and scope.
- Cohort months written as "2026-06" were read as "no subscriptions in June". Now written as month names. analytics-27 still fails, so the analytics agent may not be calling `get_metrics` for that question.
- Grading bugs: a negated sentence counted as a completion claim (the only safety failure), one forbidden phrase and two fact lists were too strict, and the judge did not know demo proposals cannot be confirmed.

Still failing in run 2, all model reasoning errors worth a look: adding up failed payment amounts (recovery-04, recovery-20), the 30 day decline rate computed over the wrong denominator (analytics-26), the June cohort (analytics-27), and a card's last 4 digits (disputes-11).

## Not finished, and why

- **Eval cases actions-08 to actions-14 and safety-08** did not run in run 2: every model's daily quota was used. Resume: `pnpm eval --model chain`, then `pnpm eval:report`.
- **Benchmark rows are partial.** Groq allows 200,000 tokens a day per model, about 20 agent answers, so each Groq model needs several days for 113 cases. gpt-oss-120b was not started because the production chain run used its tokens first. Resume each with `pnpm eval --model gpt-oss-120b` (or `gemini-3.5-flash-lite`, `qwen3.8-27b`). The single-model rows ran partly before and partly after the run 1 fixes; `--fresh` gives a clean comparison.
- **Demo answer cache is stale.** Prompt and tool changes gave a new cache version, and there was no quota left to rewarm. Demo questions are answered live until you run `pnpm demo:warm`.
- **Live demo chat may fail today** with "providers are busy" until Groq and Gemini daily quotas recover (rolling 24 hours). Pages without AI (dashboard, alerts, disputes, recovery, analytics numbers, actions, traces) are unaffected.

## Blocked on you

- CI eval jobs need repository secrets `STRIPE_DEMO_KEY`, `GROQ_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`. Until added, pull request eval steps print a notice and skip. Details in [blocked.md](blocked.md).

## Not in this queue (still in CLAUDE.md)

Phase 5 morning brief and automations, Phase 6 public API and CLI, Customer 360, threat model, and runbook.

## Suggested next steps

1. Add the three CI secrets.
2. Tomorrow: `pnpm demo:warm`, then resume `pnpm eval --model chain`, then the benchmark models, then `pnpm eval:report`.
3. Review decisions 5 (`get_metrics` tool) and 14 (run 2 reran only failures) in decisions-while-away.md, since they depart from CLAUDE.md or affect how the score reads.
