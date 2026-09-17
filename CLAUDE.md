# Stripe Ops Agent

Context doc for Claude Code. Read fully before writing any code.
Every decision here is final unless the human changes it. Build in the phase order below;
finish and commit a phase before starting the next.

## What this is

A deployed web app where a Stripe merchant connects a test account by pasting a restricted key
(read-only unless they grant writes) and gets a team of AI agents that:

1. Answer plain-English questions over payments, customers, subscriptions, invoices, and disputes,
   calling the Stripe API through tools and citing the exact Stripe object IDs they looked at.
2. Draft dispute evidence submissions in the format Stripe requires.
3. Find failed and past-due invoices, explain decline reasons, draft a retry plan and a customer email.
4. Flag anomalies: refund spikes, chargeback rate approaching the 0.75% threshold, unusual decline rate.
5. Propose actions (refund, coupon, pause or cancel subscription) behind an explicit confirmation step,
   with every action logged, and refuse writes when the connected key is read-only.
6. Run proactively: a daily morning brief by email and in-app.
7. Execute plain-English automations the merchant writes, compiled to stored rules.
8. Report revenue analytics (MRR, churn, cohort retention, decline rate by brand and country) with a narrative.
9. Expose a public REST API and a CLI.
10. Show a Customer 360 page with a churn explanation (built last, weakest evidence).

Everything runs against Stripe test mode. No live keys anywhere in this repo, ever.

## Why it exists (the job)

This is a portfolio project for a Stripe PM New Grad Accelerator application. The JD asks for:
- working with users daily and building from their problems (covered by docs/discovery/)
- owning discovery, design, implementation, deployment, iteration (covered by the changelog)
- quality bar: tests, evals, CI, safe writes (covered by tests/, evals/, docs/adr/, threat model)
- AI-enabled features on financial infrastructure (the product itself)
- optimizing your own workflow and showing others (covered by docs/workflow.md)

If a task does not serve one of those five, skip it.

## Stack (do not swap)

- Next.js 15, App Router, TypeScript strict, pnpm
- Postgres on Neon (free), Drizzle ORM
- Stripe Node SDK, test mode only, webhooks for sync, seeded history dated via `occurred_at`,
  restricted keys pasted by the merchant for onboarding (not Connect OAuth, see ADR 0005)
- LLM: Vercel AI SDK v7. Provider selection in one file: lib/llm/provider.ts, as an ordered chain that moves
  to the next model on 429, 5xx, or network errors. Since 2026-09-17 the chain is Groq gpt-oss-120b, Groq
  gpt-oss-20b, Gemini 3.5 Flash Lite, Gemini 3.1 Flash Lite (free tiers). Gemini 3.5 Flash was the primary
  but its free tier allows 20 requests a day. Groq no longer offers a Llama chat model.
- Tailwind + shadcn/ui for UI. Plain, fast, no animations.
- Vercel Cron (daily, Hobby plan) for proactive mode and scheduled automations.
- Resend (free tier) for the morning brief email.
- Vitest for tests. GitHub Actions for CI.
- Deploy to Vercel (free). Env vars documented in .env.example.

No external tracing or observability service. Traces live in our Postgres.

## Repo layout

```
app/                      Next.js routes: dashboard, chat, disputes, recovery, alerts, actions,
                          analytics, customers/[id], rules, briefs, traces, settings, docs
app/api/v1/               public REST API
app/api/stripe/           webhook
app/api/cron/             daily brief, scheduled rules
cli/                      CLI that calls the public API
lib/stripe/               Stripe client, typed wrappers, webhook handler, key permissions, account resolution, seed
lib/crypto/               encryption for stored keys, cookie signing
lib/llm/                  provider.ts (model chain)
lib/agents/               planner/ and one folder per specialist: disputes/, recovery/, analytics/, actions/
                          each with prompt.ts and tools.ts
lib/tools/                one file per tool (read/ and write/ separated)
lib/alerts/               anomaly rules
lib/analytics/            MRR, churn, cohorts, decline breakdowns (pure functions)
lib/automations/          rule schema, compiler, executor
lib/brief/                morning brief builder and email
lib/trace/                trace writer and reader
lib/db/                   Drizzle schema + migrations
evals/                    cases.json, safety.json, runner, benchmark, judge-cache.json, results.md
tests/                    unit + integration
docs/discovery/           complaints.csv, evidence.csv (verbatim proof per complaint), clusters.md
docs/adr/                 0001 to 0005
docs/spec.md              one-page product spec
docs/threat-model.md
docs/runbook.md
docs/changelog.md         every ship, tied to a complaint ID
docs/workflow.md          how this was built
docs/learn/               one plain-English explainer per phase
README.md
```

## Keys and auth

- `STRIPE_SEED_KEY`: write-capable test key. Used only by `pnpm seed`. Never set in Vercel.
- `STRIPE_DEMO_KEY`: read-only restricted test key for the seeded demo account. Used by demo mode.
- The seed script refuses to run if the key equals `STRIPE_DEMO_KEY`, or does not start with
  `sk_test_` or `rk_test_`. Covered by a test.
- Merchants connect by pasting a restricted test key (`rk_test_`) on /settings (ADR 0005). Connect OAuth
  was dropped: Stripe allows `read_only` scope only for Extensions, and the token exchange needs the
  platform's full secret key on the server. Full secret keys and live keys are refused.
- On save, lib/stripe/permissions.ts probes the key without changing data: reads by listing, writes by
  calls that must fail with 404 or 400 when permitted and 403 when not. Keys missing any read the tools
  need are rejected. Write permissions are stored per resource (refunds, coupons, subscriptions, disputes).
- The key is stored AES-256-GCM encrypted (`KEY_ENCRYPTION_SECRET`) and cleared on disconnect. The browser
  holds only an HMAC-signed connection ID cookie (`SESSION_SECRET`), HttpOnly, SameSite=Lax.
- lib/stripe/account.ts `resolveAccount` is the only place that picks the Stripe client for a request.
  Anything that does not check out falls back to the read-only demo account.
- Writes are opt-in by granting write permissions on the key. Confirmed writes execute only if the stored
  permission for that resource is true and a fresh probe still agrees. Demo mode always refuses.
- Connected accounts do not send webhooks to us (the key cannot register endpoints read-only), so their
  alerts are evaluated on page load and by cron. Webhooks cover the demo account.
- Demo mode: if no account is connected, use the demo account so a recruiter can click in with zero setup.
- Never let any model see or print a key or token.

## Agent design

- Multi-agent, built on the Vercel AI SDK only. No other agent framework.
- Planner: reads the request, routes to one or more specialists, merges their answers. It has no Stripe tools.
- Specialists, each with its own prompt, tools, and eval cases:
  - disputes: list_disputes, get_dispute, get_charge, get_customer, search; write: submit_dispute_evidence
  - recovery: list_invoices, list_subscriptions, list_charges, get_customer, search
  - analytics: list_charges, list_customers, get_customer, list_subscriptions, list_invoices, get_balance, search
  - actions: read tools as needed; write: create_refund, create_coupon, pause_subscription, cancel_subscription
- WRITE tools never execute directly. They return a proposed action object. The UI renders it with a
  Confirm button. Only after confirm does the server execute, and it re-checks key permissions first.
- Automations, cron jobs, and the public API follow the same rule: they can create alerts, drafts, and
  proposed actions, never execute a write. Confirmation happens only in the UI.
- Every tool call (read or write) is written to audit_log: timestamp, agent, tool, params, Stripe IDs touched, result.
- Every run is written to traces: planner decision, specialist calls, tool calls, provider, model,
  tokens, latency, errors. The /traces page renders them as a tree.
- Every answer must end with a "Sources" list of Stripe object IDs it used. If it used none, say so.
- Prompts are short and live in lib/agents/<agent>/prompt.ts. Each states the read/write rule explicitly.

## Stripe test data (seed script: pnpm seed)

Idempotent: check before create, tag everything with metadata.seed=true.

History (no test clocks in the demo dataset, see docs/adr/0001-test-clocks.md):
- Why: Stripe cannot backdate charges, refunds, or disputes. Test clocks cap at 3 customers each,
  auto-delete after 30 days along with their customers and subscriptions, and hide their objects from
  list calls unless filtered. A long-lived public demo cannot depend on them.
- The seed gives every object an intended date in the last 90 days, written to Stripe metadata
  `seed_occurred_at` (unix seconds) and to our DB as `occurred_at`.
- Demo time is frozen: in demo mode, "now" is the completion time of the last seed run, stored in our DB.
  Alerts, analytics, briefs, and evals take `now` as a parameter and read `occurred_at`, so windows
  never drift as real days pass.
- Connected accounts use Stripe `created` and the real current time.
- Run one test clock experiment (does a PaymentIntent for a clock customer get `created` at frozen time?),
  record the result in ADR 0001, then delete the clock. The seed itself does not use clocks.
- README notes that demo dates come from `occurred_at`, not Stripe `created`.
- Use PaymentMethod tokens (pm_card_...) in API calls, not raw card numbers. Declining cards cannot be
  attached to customers, so use them on one-off PaymentIntents. All documented decline cards are Visa,
  so decline rate by brand only varies through successful charges; note this in the analytics page.

Volumes:
- 40 customers with realistic names and emails
- 5 products, 8 prices (monthly and annual)
- 25 active subscriptions, 5 past_due, 3 canceled
- 350 successful charges over the last 90 days: about 333 in the trailing 30 days, the rest spread
  across days 31 to 90. This keeps the trailing 30 day dispute rate near 0.6%.
- Failed payments using test cards: 4000000000000002 (generic decline),
  4000000000009995 (insufficient funds), 4000000000000341 (attaches, fails on charge)
- 2 disputes, both in the trailing 30 days: 4000000000000259 (fraudulent), 4000000000001976
  (product not received). Target trailing 30 day rate near 0.6%, so the 0.5% warning fires but
  Stripe's 0.75% is not crossed.
- `pnpm seed --spike` adds 3 more disputes to push the rate over 0.75%. Disputes cannot be deleted, so the
  seed refuses `--spike` unless the account ID matches `SPIKE_ALLOWED_ACCOUNT`. Never set it to the demo account.
- 6 refunds, 3 of them on the same day so the refund-spike rule fires
- Charges carry metadata order_id and shipping_tracking, so dispute evidence has something to pull
- Varied card brands and countries on charges so the decline breakdown has data

Verify all test card numbers against Stripe docs before use. If a card behaves differently, fix the seed, not the docs.

## Build phases

### Phase 1: discovery and spec
- Collect 50+ real merchant complaints from Reddit (r/stripe, r/SaaS), Stripe community forum,
  X, GitHub issues, Indie Hackers. Store in docs/discovery/complaints.csv:
  id, source_url, date, short_paraphrase (under 20 words), tag. Only real, checked URLs.
- Cluster into 5 pains in docs/discovery/clusters.md with counts.
- Write docs/spec.md: problem, users, what v1 ships, what it does not, success metric, risks.
- Every feature below must reference at least one complaint ID.

### Phase 2: core
- Next.js, DB, Stripe client, seed script, webhook endpoint (payment_intent.*,
  charge.dispute.*, invoice.*), key paste onboarding with permission check, demo mode.
- Shared agent loop, planner, specialist scaffolding, all READ tools, trace writer.
- Chat page with streaming and Sources block.
- Deploy to Vercel.
- ADR 0001 (test clocks), ADR 0002 (multi-agent), ADR 0005 (restricted keys instead of Connect OAuth).

### Phase 3: specialist features
- Disputes: page listing open disputes, disputes agent drafts evidence (product description, customer
  communication, shipping info, refund policy, uncategorized text) into the Stripe evidence fields.
  Submit only after confirm.
- Recovery: page listing failed and past-due invoices with decline codes in plain English,
  recovery agent drafts a retry schedule and a customer email per invoice.
- Alerts: rules in lib/alerts/, evaluated on webhook and on page load. Refund spike (3+ refunds in 24h),
  chargeback rate over 0.5% trailing 30 days (warn before Stripe's 0.75%), decline rate over 15%
  trailing 7 days. Shown on dashboard.
- Actions agent, WRITE tools, confirmation UI, audit log page.
- Trace viewer page.
- ADR 0003 (confirm-before-write).

### Phase 4: analytics
- lib/analytics/: MRR, churn, cohort retention, decline rate by card brand and by country. Pure
  functions over synced data, unit tested.
- Analytics page with charts and an AI narrative from the analytics agent, with Sources.
### Phase 5: proactive mode and automations
- Daily Vercel cron: runs the specialists, builds a morning brief (alerts, disputes due soon, failed
  invoices, MRR change), stores it, shows it on /briefs, emails it via Resend. Cron route checks CRON_SECRET.
- Automations: merchant types a rule in plain English. The agent compiles it to a typed rule
  (trigger: webhook event or schedule; conditions; action: alert, brief item, draft, or proposed action).
  The merchant reviews the compiled rule before it is saved. Cron and webhooks execute rules.
  Rules page shows each rule and its run history.

### Phase 6: public API and CLI
- REST API under /api/v1: read endpoints for the same data the tools use, an ask endpoint that runs
  the planner, and endpoints that create proposed actions. Auth with API tokens created in settings,
  stored hashed. Rate limited.
- CLI in cli/ that wraps the API (ask, disputes, invoices, alerts, briefs).
- /docs page documenting every endpoint and CLI command.

### Phase 6b: Customer 360 (last feature)
- Built after every other feature because it has the weakest evidence: 3 indirect complaints
  (C044, C050, C069), none asking for a per-customer view. Cut it first if time runs short.
- Customer 360 page: profile, subscriptions, invoices, charges, disputes, timeline, and a churn
  explanation for churned or at-risk customers.

### Phase 7: quality
- evals/cases.json: 100 question/answer cases over the seeded data, tagged by agent, including planner
  routing cases. Each has: question, agent, expected facts (object IDs or numbers that must appear),
  forbidden facts. Runner scores with an LLM judge plus exact-match on IDs. Output evals/results.md
  with per-case pass/fail, per-agent totals, and an overall total. Commit results.
- evals/safety.json: 10 cases where the user asks for a write ("refund John") and the agent must return
  a proposed action, never execute. Runner asserts zero executed writes in the audit log. Plus 3 cases
  with a read-only key where the agent must explain it cannot write.
- Judge cache: key is a hash of question plus answer, stored in evals/judge-cache.json and restored in CI.
- Model benchmark: run the full suite across Groq gpt-oss-120b, Gemini Flash Lite, and one more free-tier model.
  Leaderboard in README: pass rate, safety pass rate, p50 latency, rate-limit errors.
- tests/: seed idempotency, seed refuses demo key, permission check, alert rules, analytics math,
  rule compiler, planner routing, tool param validation, webhook signature check, key permission probes,
  key encryption and cookie signing, account resolution,
  cron secret check, API token auth.
- CI:
  - every push: lint, typecheck, test
  - pull request: 13 safety cases plus 5 sampled eval cases
  - manual dispatch: full 100-case suite
- Rate limit handling: cache demo-mode answers for the 10 most common questions; fall down the model chain on 429.

### Phase 8: engineering docs
- docs/adr/: 0001 test clocks, 0002 multi-agent, 0003 confirm-before-write, 0004 free tiers, 0005 restricted keys instead of Connect OAuth.
  Write each when its decision is implemented, not at the end.
- docs/threat-model.md: assets, trust boundaries, threats (prompt injection via Stripe data, key leakage,
  unconfirmed writes, stored merchant key theft, forged session cookie, API token theft, cron abuse), mitigations.
- docs/runbook.md: rate limits, provider outage, webhook failures, cron failures, rotating keys, reseeding.

### Phase 9: ship
- README: what it is, live demo link, screenshot, eval score, benchmark leaderboard, how safety works,
  stack, how to run, sources, and the occurred_at note if it applies.
- docs/changelog.md: one line per ship, each with time, what changed, complaint ID.
- docs/workflow.md: tools used, how the build was structured, what got automated, what would change.
- Final push, tag v1.0.0.

## Rules for Claude Code

- Commit after every working feature with a message that names the complaint ID. Small commits, many of them.
- Push to GitHub after every commit.
- At the end of every phase, before committing, write docs/learn/<phase>.md: a plain-English explanation of
  what was built, why, and how the pieces connect, at most 20 lines, for someone who has never seen the code.
  Do not quiz the human or wait; continue with the next phase.
- Never add Co-Authored-By or any attribution lines to commits or PRs.
- Real keys go only in .env.local. .env.example holds placeholders and is committed.
- Write the test before or with the feature, not at the end.
- No em dashes anywhere in code comments, docs, or UI text.
- Do not add features not in this doc. If something is blocked, write it in docs/blocked.md and move on.
- Ask the human before: changing the stack, adding a paid service, touching anything named "live".
- If a free tier rate limit blocks progress, switch provider in lib/llm/provider.ts and note it in the changelog.

## Definition of done

- Live URL works in demo mode with no setup.
- Key paste onboarding works with a second test account, with a read-only key and with a write key.
- All 100 eval cases run, score and benchmark leaderboard in README, safety evals 100%.
- CI green.
- Morning brief arrives by email and in-app; at least one automation has run history.
- API and CLI documented on /docs.
- docs/ complete: discovery, spec, 5 ADRs, threat model, runbook, changelog, workflow.
- No secrets in the repo. .env.example complete.
