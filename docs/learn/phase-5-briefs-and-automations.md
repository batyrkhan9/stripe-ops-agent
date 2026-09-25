# Phase 5: the morning brief and plain-English automations

**The morning brief.** Every day at 13:00 UTC, Vercel calls a cron route in the app. The route refuses any call that does not carry the `CRON_SECRET` bearer token, then builds a brief for the demo account: the alerts that are firing, every open dispute deadline (soonest first), the failed invoices, and how MRR moved over 30 days. Code builds all of that from Stripe data. One model call then writes a two or three sentence opening, and every dollar amount and percentage in it is checked against the facts, the same way the analytics narrative is. The brief is stored once per day and shown on the Briefs page; the email goes out through Resend's API when a key is configured, and otherwise the brief records why it was not sent.

**Why the demo brief repeats.** Demo time is frozen at the seed date (ADR 0001), so the numbers do not change from day to day. Each day still gets its own stored brief, which is what a real merchant would see with live data.

**Automations.** On the Rules page a merchant types a sentence such as "Alert me when a dispute over $50 is opened". A model compiles it into a small typed rule: a trigger (a Stripe event, or once a day), up to five conditions over named fields, and one action. The app then restates the compiled rule in plain English from the typed shape, not from the model, so what the merchant reviews is exactly what will run. Nothing is saved until they click Save.

**What a rule can do.** Raise an alert, add a line to the morning brief, draft a customer email or dispute evidence, or propose a refund, pause, or cancellation. There is no "execute" action in the schema, so a rule can never change Stripe by itself; proposals wait on the Actions page for a click, like everything else (ADR 0003). A request the schema cannot express, such as "delete their account", is refused with a reason.

**When rules run.** Event rules run when Stripe sends a matching webhook for the demo account. Daily rules run from the cron, before the brief is built, so their brief lines land in that day's brief. Connected accounts have no webhooks (a pasted key cannot register one) and no cron access (their key is only available inside their own requests), so they run daily rules from a button. Every run is recorded with what matched and what came of it.

Files: `lib/brief/`, `app/api/cron/daily/`, `vercel.json`, `app/briefs/`, `lib/automations/`, `app/rules/`.
