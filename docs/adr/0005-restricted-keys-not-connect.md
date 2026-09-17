# ADR 0005: Onboard with pasted restricted keys, not Connect OAuth

Status: accepted, 2026-09-17

## Context

The plan was Stripe Connect OAuth with `read_only` scope by default and `read_write` as an opt-in, so that
Stripe itself would enforce what the agent can do. Stripe's docs (checked 2026-09-17) rule that out:

- "Only Extensions can use `read_only`." Becoming an Extension means contacting Stripe support. A regular
  Connect platform can only request `read_write`.
- "OAuth isn't recommended for new Connect platforms."
- The token exchange runs with the platform's secret API key, so a full write-capable key would live on
  the server.

With `read_write` as the only scope, "read-only" would be a promise our code makes, not a limit Stripe enforces.

## Decision

- The merchant creates a restricted test key (`rk_test_`) in their own Stripe Dashboard, granting only the
  permissions they want, and pastes it on /settings. Full secret keys and live keys are refused.
- On save the app probes the key without changing data. Reads are checked by listing one object. Writes
  are checked with calls that cannot succeed: updating an object that does not exist, or creating a coupon
  with no amount. Stripe answers 403 when the key lacks the permission and 404 or 400 when it has it. We
  confirmed this against a full key and a read-only key, and rejected probes where Stripe checks the object
  before the permission (a read-only key got 404 on refund create and coupon update).
- The key is stored AES-256-GCM encrypted and deleted on disconnect. The browser keeps only a signed
  connection ID cookie.
- One function, `resolveAccount`, chooses the Stripe client per request and falls back to the read-only
  demo account whenever anything fails to check out.

## Consequences

- Stripe enforces read-only. A read-only key cannot write no matter what the model or our code does.
- Writes are opt-in per resource by granting that permission on the key, and are re-checked before any
  confirmed write runs.
- No platform secret key on the server. The server does hold merchant keys, so encryption, key deletion on
  disconnect, and never showing keys to the model are covered in the threat model.
- Pasting a key is less polished than a Connect button. The settings page lists exactly which permissions to grant.
- Stripe does not send webhooks for a pasted key's account to us, so connected accounts get alerts on page
  load and by cron, not in real time. Webhooks cover the demo account.
- The account ID is unknown unless the key can read the account, which most restricted keys cannot.
