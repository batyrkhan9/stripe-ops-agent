# ADR 0001: Date demo history with occurred_at, not test clocks

Status: accepted, 2026-09-16

## Context

Alerts, analytics, and evals need 90 days of history: refund spikes inside 24 hours, a dispute rate over
a trailing 30 days, a decline rate over a trailing 7 days. Stripe sets `created` to real time on most
objects and has no backdating parameter for charges, refunds, or disputes.

Test clocks were the original plan. Stripe docs state these limits:
- At most 3 customers per clock, and 3 subscriptions per customer.
- Clocks are deleted 30 days after creation, along with their customers and subscriptions.
- List endpoints do not return clock objects unless filtered by customer, subscription, or clock.

We ran one experiment on the demo account (2026-09-17) with a clock frozen 60 days in the past:

| Object | `created` |
|---|---|
| Customer | frozen time |
| Subscription | frozen time |
| Invoice | frozen time |
| PaymentIntent | real time |
| Charge | real time |
| Refund | real time |

The clock customer did not appear in a plain `customers.list` call. `deletes_after` was 30 days after creation.

## Decision

- The demo dataset uses regular customers, no test clocks.
- The seed assigns every object an intended date in the last 90 days, written to Stripe metadata
  `seed_occurred_at` (unix seconds) and to our DB as `occurred_at`.
- Demo time is frozen. In demo mode, "now" is the seed anchor time stored in our DB. Alerts, analytics,
  briefs, and evals take `now` as a parameter and read `occurred_at`.
- Connected accounts use Stripe `created` and the real current time.

## Consequences

- The demo never expires and the agent's list tools behave the same on demo and real accounts.
- Demo mode has one code path that differs from real accounts: where the date comes from. It is isolated
  in one function and covered by tests.
- Stripe dashboard dates for demo objects show the seed day, not the intended date. The README says so.
- Charges, the objects that matter most for the rate alerts, could not have been backdated by clocks
  anyway, so a clock-based seed would have needed `occurred_at` too.
