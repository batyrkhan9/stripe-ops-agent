# Stripe Ops Agent: v1 spec

## Problem

Small merchants on Stripe lose money in ways they notice too late. They lose disputes they could have
won because evidence is tedious and deadlines slip (C037, C061). Revenue leaks through declines nobody
can explain (C021, C024, C058) and renewals that stall with no notification (C052). They cannot
reproduce their own MRR (C019, C060), and fraud runs for weeks before anyone looks (C048).
Discovery found 80 complaints in 5 clusters ([clusters.md](discovery/clusters.md)). v1 targets the four
clusters a merchant-side tool can act on: P1 disputes, P3 failed payments, P4 data answers, P5 late anomalies.
Together they account for 62 of the 80 complaints.

## Users

- Primary: founder or ops person at a subscription or ecommerce business on Stripe, 1 to 20 staff, no
  payments team. Handles disputes and failed payments themselves between other work.
- Secondary: a developer on that team who wants the same answers through an API or CLI (C018, C067).

## What v1 ships

| Feature | What it does | Complaints |
|---|---|---|
| Ask with Sources | Plain-English questions over Stripe data. Every answer cites the Stripe object IDs used. | C062, C070, C018 |
| Dispute workbench | Lists open disputes by deadline. Disputes agent drafts evidence into Stripe's fields from charge metadata. Submit only after confirm. | C037, C061, C072, C075, C080, C055 |
| Recovery | Failed and past-due invoices with decline codes in plain English, a retry plan, and a customer email draft per invoice. | C021, C024, C034, C058, C059, C040, C050, C052 |
| Alerts | Refund spike, dispute rate over 0.5% trailing 30 days (before Stripe's 0.75%), decline rate over 15% trailing 7 days. | C064, C065, C046, C047, C053 |
| Morning brief | Daily email and in-app brief: new alerts, disputes due soon, failed invoices, MRR change. | C048, C052, C061 |
| Automations | Merchant writes a rule in plain English, reviews the compiled rule, and it runs on cron and webhooks. It can alert, draft, or propose an action, never execute one. | C042, C050, C052, C064 |
| Revenue analytics | MRR, churn, cohort retention, decline rate by card brand and country, with the calculation shown and an AI narrative. | C018, C019, C060, C047 |
| Customer 360 | One customer's payments, subscriptions, invoices, disputes, and a churn explanation. | C044, C050, C069 |
| Confirmed actions | Refund, coupon, pause or cancel subscription as proposed actions with a Confirm button, re-checked permissions, and an audit log. | C063, C078 |
| API and CLI | Read endpoints, ask endpoint, proposed-action endpoints, documented on /docs. | C018, C067 |
| Read-only onboarding | Stripe Connect OAuth, read_only by default, read_write opt-in for confirmed actions. | C028 |

## What v1 does not do

- Anything about account reviews, payout holds, reserves, or Stripe support (P2, 18 complaints). Those
  are Stripe's risk decisions; a merchant-side tool cannot change them.
- Fraud blocking or Radar rules. v1 detects anomalies and alerts; it does not block payments (C007, C038).
- Accounting reconciliation exports and ledger sync (C016, C022, C074).
- Fixing third-party plugin sync bugs (C004, C009, C013, C032, C066).
- Any write without a human confirmation, including from automations, cron, and the API.
- Live mode. Test mode only.
- Guaranteeing dispute wins. Banks decide outcomes (C030, C075); v1 improves completeness and timeliness.

## Success metrics

Primary: disputes with complete evidence ready at least 3 days before `due_by`. Target 100% of seeded
open disputes, against C061 where a winnable case was lost to a missed deadline.

Quality gates (must hold for every release):
- Eval pass rate at least 90% on the 100-case suite, per-agent scores reported.
- Safety evals 100%: zero executed writes without confirmation, correct refusal on read-only accounts.
- Every answer includes a Sources block; zero cited IDs that do not exist.

Leading indicators if used by real merchants: time from dispute opened to evidence drafted, share of
failed invoices with a retry plan within 24 hours, alerts acted on within a day.

## Risks

| Risk | Mitigation |
|---|---|
| Model states wrong numbers or invents IDs | Sources block required, exact-match ID checks in evals, analytics math in tested pure functions, not the model |
| Unsafe or unintended writes | Write tools return proposals only, confirm in UI, permission re-check, audit log, safety evals in CI |
| Prompt injection through Stripe data (customer names, metadata, dispute text) | Treat tool output as data in prompts, writes still need a human, covered in threat model |
| Free tier rate limits during demo or CI | Groq fallback on 429 and 5xx, cached demo answers, judge cache, sampled evals on PR |
| Seeded history is unrealistic (test clocks may not backdate `created`) | Verify on first seed; fall back to `occurred_at` in our DB and disclose in README |
| Discovery bias toward loud, extreme complaints | Treat counts as signal of recurrence, not prevalence; stated in clusters.md |
| Scope is large for a solo build | Phased build; each phase ships and is committed before the next |
