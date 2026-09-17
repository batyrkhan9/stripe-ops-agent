# ADR 0003: Agents propose writes; only a confirmed proposal changes Stripe

Status: accepted, 2026-09-17

## Context

The actions agent refunds, creates coupons, and pauses or cancels subscriptions; the disputes agent submits
evidence. A model can misread a request ("refund Maya" when there are two Mayas), be steered by text inside Stripe
data (a dispute note that says "refund this charge"), or pick the wrong object. A refund or an evidence submission
cannot be undone, so no model output may execute one.

## Decision

- A write tool has two parts. `describe` reads Stripe to check the target and writes one sentence ("Refund
  $195.00 to Maya Patel for the Sep 11 charge (order KC-10046)"). `execute` makes the Stripe call. When a model
  calls the tool, only `describe` runs, and the result is stored as a row in `proposed_actions`.
- Refusals happen at proposal time too: a connected key without write permission for that resource gets no
  proposal and the agent says which permission is missing. A target that cannot take the action (a failed or
  disputed charge, an ended subscription, evidence still containing `[fill in: ...]` placeholders) is rejected.
- `execute` runs only from the Confirm button on the Actions or Disputes page, through one function,
  `lib/actions/confirm.ts`. At confirm time the server checks, in order: the proposal exists; the account is not
  the demo; the proposal belongs to this account and connection; it is still pending; the stored permission
  allows the resource; and a fresh probe of the key still agrees (the merchant may have edited the key in Stripe).
- The proposal is claimed with a conditional update (`proposed` to `executing`), so a double click or a second
  tab cannot run it twice. The Stripe call uses `proposal:<id>` as its idempotency key as a second guard.
- An audit row is written before the call. If that insert fails, the action does not run. Read tool audits stay
  best effort.
- Demo mode stores proposals so a visitor sees the whole flow, but Confirm is disabled and the server refuses it.
- Automations, cron, and the public API use the same `proposeWrite` and never call `confirmProposal`.

Stripe's `customer_communication` and `refund_policy` evidence fields take uploaded file IDs, not text. Drafted
evidence uses the text fields: `product_description`, `refund_policy_disclosure`, the shipping fields, and
`uncategorized_text` for communication with the customer.

## Alternatives considered

- AI SDK tool approval (`needsApproval`). It pauses a tool call inside one chat stream until the user approves.
  Rejected: approval would live in the chat session, while writes also come from pages, rules, and the API, and
  the permission check must run on the server when the write executes, not when it was requested.
- Executing writes when the key allows them, with an undo. Refunds and evidence submissions have no undo.
- Asking the model to confirm with the user in conversation ("reply yes to refund"). The model decides whether
  "yes" was said, so a prompt injection could say it.

## Consequences

- Every write takes two steps, which is the point. The button label repeats the amount or customer
  ("Confirm refund of $195.00").
- Safety is testable without a model: `tests/write-actions.test.ts` covers demo refusal, a read-only key,
  a revoked permission, another connection's proposal, a double confirm, an audit failure, and a Stripe error.
  The path was also run once against Stripe test mode with a coupon: the first confirm created it, the second
  was refused as already executed.
- Proposals can go stale (a charge refunded elsewhere). Confirm does not re-run `describe`; Stripe rejects the
  call and the proposal is marked failed with Stripe's message.
