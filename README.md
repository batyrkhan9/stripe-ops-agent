# Stripe Ops Agent

AI agents that help a small merchant run Stripe: answer questions with cited Stripe object IDs, draft
dispute evidence, recover failed payments, and flag anomalies before Stripe's risk thresholds. Writes
only happen after a human confirms. Test mode only.

Live demo: https://stripe-ops-agent.vercel.app (demo mode, no setup, read-only).

Work in progress. Product spec: [docs/spec.md](docs/spec.md). Discovery: [docs/discovery/](docs/discovery/).

## Demo data

The demo account is a Stripe test-mode sandbox filled by `pnpm seed`. Every object the seed creates has
metadata `seed=true` and a unique `seed_key`, and re-running the seed creates nothing new.

### Dates come from `occurred_at`, not Stripe `created`

Stripe cannot backdate charges, refunds, or disputes, so every seeded object was created on 2026-09-17
in Stripe's eyes. The seed stores each object's intended date in metadata `seed_occurred_at` and in the
`seeded_objects` table. In demo mode the app treats "now" as the seed anchor, 2026-09-17 04:39 UTC, so
the 24 hour, 7 day, and 30 day windows never drift. Why: [ADR 0001](docs/adr/0001-test-clocks.md).

What the seed targets:
- 350 successful charges, about 300 of them in the trailing 30 days
- 2 open disputes, a trailing 30 day dispute rate of 0.65%: over the 0.5% warning, under Stripe's 0.75%
- 35 declines, a trailing 7 day decline rate of 22%
- 6 refunds, 3 of them in the last 24 hours
- 25 active, 5 past_due, and 3 canceled subscriptions

### Documented leftovers

Design experiments on 2026-09-17 (test clocks, dispute cards, past_due flows) left objects in the demo
account that are not part of the seed. They are tagged `seed_key=experiment` where Stripe allows it. The
agent sees them through the Stripe API; demo alerts, analytics, and evals read `seeded_objects` and
ignore them.

| Object | Count | Notes |
|---|---:|---|
| Charges | 9 | 7 succeeded, 2 failed. Tagged. |
| Payment intents | 9 | Behind the 9 charges. Tagged. |
| Disputes | 2 | `du_1UGX1c3FpwYTqedqZdxiQeqY` (fraudulent), `du_1UGX1f3FpwYTqedqxBotI4fs` (product not received), both closed as lost. Tagged. |
| Refunds | 1 | 1.00 USD on a 10.00 USD charge. Tagged. |
| Invoices | 4 | Tagged. |
| Products | 3 | Archived. Tagged. |
| Prices | 4 | Tagged. |
| Subscriptions | 3 | `sub_1UGX1W3FpwYTqedqc5dbOq8t`, `sub_1UGX223FpwYTqedqVC1eW1C6`, `sub_1UGX283FpwYTqedqpLOrH7zF`. Not tagged: Stripe refuses updates to `incomplete_expired` subscriptions. |

The customers behind these objects were deleted.

### `--spike`

`pnpm seed --spike` adds 3 disputes to push the dispute rate over 0.75%. Stripe cannot delete disputes, so
this is permanent. The seed refuses `--spike` unless the Stripe account ID matches `SPIKE_ALLOWED_ACCOUNT`,
which should name a separate test account, never the demo account.
