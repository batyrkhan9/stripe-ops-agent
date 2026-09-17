# Phase 3: answers people can read, and the specialist pages

**Readable answers.** Every answer now opens with one or two plain sentences, uses names, amounts, and deadlines like "due Sep 25, in 8 days", and ends with one next step and a button to the right page. Stripe IDs sit in a collapsed Sources list. Disputes, failed invoices, alerts, and proposed actions appear as cards that code builds from Stripe data, so the model cannot get a name or amount wrong on a card. Five format evals check these rules automatically.

**Demo cache.** Free AI tiers run out quickly, so answers to the 10 example questions are saved in Postgres and replayed instantly. An answer is saved only if it passes every format rule. The cache key includes the prompt version and demo date, so changing a prompt or reseeding retires old answers.

**Alerts.** Three rules watch the account: dispute rate over 0.5% in 30 days (Stripe starts monitoring at 0.75%), 3 or more refunds in 24 hours, and a decline rate over 15% in 7 days. They are plain functions, run when a page loads and when Stripe sends a relevant webhook, and each firing is kept as history. The dashboard shows firing alerts, disputes needing a response, and failed invoices.

**Disputes.** Pick a dispute and the page gathers facts from Stripe: customer history, card checks, order, tracking. The AI writes the narrative from those facts only, and marks what only the merchant knows as "[fill in: ...]". The merchant edits, then proposes the submission, which is refused while any placeholder remains.

**Recovery.** Each failed invoice shows why it failed in plain English, a retry plan built from the decline type (soft declines are retried days apart, hard declines never), and an AI-drafted email the merchant copies. Nothing is sent.

**Writes need a confirm.** When an agent or page wants to refund, create a coupon, pause or cancel a subscription, or submit evidence, it only stores a proposal. The change runs only when the merchant clicks Confirm, after the server re-checks the key's permission with Stripe and makes sure the proposal cannot run twice (ADR 0003). The demo account can propose but never confirm. Every tool call and every confirm is in the audit log on the Actions page.

**Traces.** The Traces page lists every chat run with its route, models, tokens, and time, and opens into a tree of each step.

Files: `lib/agents/rules.ts`, `lib/demo/`, `lib/alerts/`, `lib/tools/write/`, `lib/actions/`, `app/disputes/`, `app/recovery/`, `app/actions/`, `app/traces/`.
