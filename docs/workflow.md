# How this was built

One person directing an AI coding agent (Claude Code in VS Code), from 2026-09-16 to 2026-09-17.
The human owned product decisions and anything touching accounts or keys; the agent wrote the code, tests,
evals, and most docs, and checked its own work against running software.

## Tools

| Tool | Used for |
|---|---|
| Claude Code | Writing and editing code, running commands, reading traces and eval output, writing docs |
| CLAUDE.md | The single source of truth: scope, stack, phases, rules. Updated whenever a decision changed |
| pnpm scripts | `seed`, `eval`, `eval:build`, `eval:report`, `eval:format`, `demo:warm`, `db:migrate` |
| Vitest | 192 unit tests over pure functions: metrics, alert rules, write safety, checks, formatting |
| Headless Chrome (puppeteer-core) | Screenshots of real pages and real agent answers after each UI change |
| GitHub Actions | Lint, typecheck, and tests on every push; safety and sampled evals on pull requests |
| Vercel | Deploy on every push to main |
| Neon, Stripe test mode, Groq, Gemini | Free tiers only (ADR 0004) |

## How the build was structured

1. **Discovery before code.** 77 real merchant complaints with verbatim evidence, clustered into 5 pains
   (`docs/discovery/`). Every feature and most commits cite complaint IDs.
2. **Phases with a definition of done.** Discovery and spec, core (seed, webhook, onboarding, agents,
   deploy), specialist features, analytics, then evals. Each phase ends with a plain-English learning note in
   `docs/learn/` so the human can follow what was built without reading the code.
3. **Decisions written down when made.** ADRs for the choices with real alternatives (test clocks, multi-agent,
   confirm-before-write, free tiers, restricted keys). Changes of plan go in CLAUDE.md so they survive context
   resets. Work done unattended is logged in `docs/decisions-while-away.md` so each call can be reversed.
4. **Small commits, pushed immediately.** 30+ commits in the first day, each a working piece.

## What was automated

- **Test data.** `pnpm seed` builds a deterministic demo account (40 customers, 350 charges, disputes,
  past-due invoices, refunds) and is idempotent, so it can be rerun safely.
- **Verification of facts.** Eval expected values are computed from the demo account by
  `evals/ground-truth.ts`, not typed by hand. Reseeding and running `pnpm eval:build` keeps all 113 cases correct.
- **Quality gates in code, not prompts.** Cards, Sources, next-action buttons, and the demo cache's format
  check are enforced by code after gpt-oss followed some prompt rules only part of the time.
- **Safety as tests.** Write safety is unit tested (demo refusal, revoked permission, double confirm, audit
  failure), then checked again by 13 eval cases with a Stripe client that blocks every write.
- **Resumable model runs.** Free tiers allow about 20 agent answers a day per Groq model, so eval runs save after
  every case and continue where they stopped.

## What worked

- Looking at the product, not just the tests. Screenshots of real answers found a hallucinated customer name, a
  dispute hidden by a date filter, a retry plan scheduled in the past, and a font that never loaded, none of which
  a unit test would have caught.
- Reading the audit log and traces when an answer looked right. The Sources block once cited a different charge
  than the refund being proposed; the fix was to cite card and proposal objects directly.
- Asking the model for less. Moving card building, next-action pages, and number checks out of prompts and into
  code made answers consistent across four different models.

## What would change next time

- Measure token use per answer from the first day. The 200,000 tokens a day limit, not requests, turned out to be
  the real constraint, and smaller tool outputs would have doubled the daily capacity.
- Build the eval harness before the answer format work, so each prompt change is scored rather than eyeballed
  with five cases.
- Seed the demo account with price history and customer-level data for Customer 360 from the start.
- Keep one throwaway Stripe test account for experiments, so the demo account has no leftovers to document.
