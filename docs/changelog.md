# Changelog

One line per ship. Times are Pacific. Complaint IDs refer to [docs/discovery/complaints.csv](discovery/complaints.csv).

| When | What changed | Complaints |
|---|---|---|
| 2026-09-16 21:43 | Idempotent demo seed: 40 customers, 33 subscriptions, 350 charges, 2 disputes, 6 refunds, dated with occurred_at so the dispute rate lands at 0.65% | C061, C064 |
| 2026-09-16 21:55 | Seeded subscription invoices and payment intents carry intended dates, for Recovery | C052 |
| 2026-09-16 21:56 | Webhook endpoint verifies Stripe signatures and stores dispute, invoice, and payment events once each | C052, C064 |
| 2026-09-16 22:27 | Merchants connect with a pasted restricted key, checked for permissions without changing data and stored encrypted (replaces Connect OAuth, ADR 0005) | C028 |
| 2026-09-16 22:40 | Live on Vercel in read-only demo mode; real Stripe webhook deliveries verified | none |
| 2026-09-16 22:53 | Pushes to main deploy production automatically | none |
| 2026-09-17 00:30 | Chat: planner routes to disputes, recovery, analytics, or actions specialists over 10 read tools; answers stream with a Sources block verified against tool results; every tool call audited and every run traced | C018, C062, C070 |
| 2026-09-17 00:30 | Provider switch: model chain now starts with Groq gpt-oss-120b. Gemini 3.5 Flash's free tier allows 20 requests a day, about 4 answers | none |
| 2026-09-17 00:37 | Answers lead with one or two plain sentences, use names, amounts, and "due Sep 25, in 8 days" deadlines, keep Stripe IDs in a collapsed Sources block, and end with one next action button. Disputes and failed invoices render as cards. 5 format evals pass (evals/format-results.md) | C018, C061, C062, C070 |
| 2026-09-17 00:37 | Finance-tool restyle: IBM Plex Sans with tabular numbers, black on white, one orange accent for actions and alerts, dense rows | none |
| 2026-09-17 00:37 | Provider chain also moves on 413: a 50 row charge list exceeded Groq's 8000 tokens a minute. List tools return at most 25 rows | none |
| 2026-09-17 00:47 | Demo answers to 10 common questions are cached in Postgres and replayed instantly, keyed by question, demo anchor, and prompt version. Only answers that pass every format rule are stored; pnpm demo:warm fills the cache and prints each answer for review | C018, C062 |
| 2026-09-17 00:47 | Answer fixes found while warming the cache: decline reasons reach the model in plain English only, next actions with Stripe IDs are retried instead of stripped, open disputes are listed whatever their age, and charge totals count refunds | C052, C061 |
| 2026-09-17 00:47 | Alerts: chargeback rate over 0.5% (30 days), 3+ refunds in 24 hours, decline rate over 15% (7 days), evaluated on page load and after Stripe webhooks, with history. Dashboard shows firing alerts, disputes needing a response, and failed invoices; analytics answers about rates show alert cards | C006, C028, C048, C061, C064 |
| 2026-09-17 00:57 | Actions: the actions agent proposes refunds, coupons, and subscription pauses or cancellations; the Actions page confirms them after re-checking the key's permission, runs each once, and shows the audit log of every tool call. Demo proposals are visible but cannot be confirmed (ADR 0003) | C028, C063, C078 |
| 2026-09-17 01:00 | Disputes page: open disputes by deadline, facts from Stripe (customer history, card checks, order, tracking), AI-drafted evidence the merchant edits, and a submission proposal that is refused while any [fill in] placeholder remains | C037, C061, C072, C075 |
| 2026-09-17 01:04 | Recovery page: failed invoices with plain-English decline reasons, a retry plan built from the decline type that never schedules in the past, a 30 day breakdown of why payments failed, and an AI-drafted customer email to edit and copy | C008, C021, C040, C052 |
| 2026-09-17 01:05 | Trace viewer: every chat run with routing, models, tokens, latency, and errors, and a step tree of planner, agents, model calls, and tool calls with their inputs and outputs | none |
| 2026-09-17 01:08 | Phase 3 format evals rerun after write tools: 4 of 5 pass. format-02 failed on gpt-oss-20b (120b was out of its daily quota): a three sentence lead that also named 3 of the 5 past-due customers; the cards showed all 5 | none |
| 2026-09-17 01:25 | Analytics page: MRR, net MRR movement, churn, gross volume, weekly MRR chart, cohort retention, decline rate by card brand and country, with the calculations shown. AI narrative written only from those numbers and checked against them. Chat gets the same numbers through get_metrics | C018, C019, C047, C060 |
