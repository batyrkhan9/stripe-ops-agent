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
