# Phase 2 so far: skeleton, demo data, webhook

**The skeleton.** A Next.js web app, with pages and server API routes in one project, and a Postgres database on Neon. GitHub runs lint, type checks, and tests on every push. The pages are placeholders for now.

**Two Stripe keys.** The seed key can write, and only runs on a laptop to create demo data. The demo key is read-only, and the deployed app uses it so a recruiter can click around without changing anything. The seed refuses to run with the demo key, and the code rejects any key that is not a test-mode key.

**The seed (`pnpm seed`).** It fills a Stripe test account with a made-up coffee subscription business: 40 customers, 33 subscriptions, 350 successful charges, 35 declines, 2 disputes, 6 refunds. It first builds a plan in pure code, the same plan every time, so tests can check the numbers before anything touches Stripe. A second step carries the plan out against Stripe.

**The date problem.** Stripe stamps every object with the real time it was created and cannot backdate a charge. Test clocks only backdate subscriptions, and they delete their data after 30 days (see ADR 0001). So each object carries its intended date, in Stripe metadata `seed_occurred_at` and in the `seeded_objects` table. In demo mode the app treats "now" as the moment of seeding, so "the last 30 days" always means the same data.

**Tuned so the alerts fire.** Dispute rate 0.65%: above our 0.5% warning, below Stripe's 0.75% threshold. Decline rate 22% over 7 days, above 15%. 3 refunds in the last 24 hours.

**Safe re-runs.** Every seeded object gets a unique `seed_key`. Before creating anything, the seed lists what Stripe already has and only creates what is missing, so running it twice changes nothing. `--spike` adds 3 disputes that can never be deleted, so it only runs on the account named in `SPIKE_ALLOWED_ACCOUNT`.

**The webhook.** Stripe notifies `/api/stripe/webhook` when things happen, for example a dispute opens or an invoice payment fails. The endpoint checks Stripe's signature, which proves the message came from Stripe and was not changed. It ignores live-mode and unrelated events and saves each remaining event once, keyed by event ID, to `stripe_events`. Later phases read that table to run alerts and automations.

Files: `lib/stripe/seed/`, `lib/stripe/keys.ts`, `lib/stripe/webhook.ts`, `app/api/stripe/webhook/route.ts`, `lib/db/schema.ts`.
