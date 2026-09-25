# Blocked

## Resolved

- 2026-09-17, automatic deploys on push. `vercel git connect` failed until the Vercel account had a GitHub
  login connection and the Vercel GitHub App was installed on the repo. Both done; pushes to main now deploy
  to production.

## Open

- 2026-09-17, eval jobs in CI need repository secrets. Add `STRIPE_DEMO_KEY` (the read-only demo key),
  `GROQ_API_KEY`, and `GOOGLE_GENERATIVE_AI_API_KEY` under GitHub, Settings, Secrets and variables, Actions.
  Until then the pull request eval steps print a notice and skip; lint, typecheck, and tests still run.
  Not done unattended because it copies your keys into another service.

- 2026-09-25, brief emails need a Resend account. Create one (free tier), verify a sender domain or use the
  onboarding sender, then set `RESEND_API_KEY`, `BRIEF_FROM_EMAIL`, and `BRIEF_TO_EMAIL` in `.env.local` and in
  Vercel (production). Until then the cron stores each brief with "not emailed (RESEND_API_KEY not set)".
  Not done unattended because it creates an account in your name.
- 2026-09-25, heads-up, not a blocker: Stripe's automatic retries are still running on the demo account's 5
  past-due invoices (5 attempts each so far). Analytics and alerts now ignore charges created after demo time,
  but when Stripe's retry schedule ends it will act on the subscription per the Dashboard setting (Billing,
  Subscriptions and emails, "Manage failed payments"). Set that to "leave the subscription past due" so the
  demo keeps its 5 past-due subscriptions; rerunning `pnpm seed` restores them otherwise.
