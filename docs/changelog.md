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
