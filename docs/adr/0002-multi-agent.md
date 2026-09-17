# ADR 0002: Planner plus four specialists, one model chain

Status: accepted, 2026-09-17

## Context

Merchant questions fall into distinct jobs: disputes, failed payments, analytics, and requests to change
something. One agent with every tool and every instruction would carry a long prompt and a large tool list
on every call, which free tiers cannot afford (Groq allows 8000 tokens a minute per model), and it would
make safety rules for write requests harder to isolate.

## Decision

- A planner reads the question and names one specialist, or two when both are clearly needed. It replies
  in plain text that we parse against the four names. JSON structured output was tried first and dropped:
  Groq's gpt-oss models rejected it with "Failed to generate JSON". If the planner fails or names nothing,
  keyword routing takes over, so routing never blocks an answer.
- Each specialist (disputes, recovery, analytics, actions) has a short prompt, its own subset of the 10
  read tools, and the shared read/write rule. Specialists run one after another in the same streamed reply.
- All tools run through one executor that validates input, audits the call, and redacts anything shaped
  like a key before the model sees it.
- The Sources block is built by code, not written by the model: IDs the answer cites that a tool returned
  are listed, and IDs no tool returned are flagged.
- List tools return totals and include customer names and latest invoices, so one call answers most
  questions. Before this, "which subscriptions are past due" took 12 tool calls and 40 seconds; after, 1 call
  and 6 seconds.

## Consequences

- Answers take 3 to 6 seconds on Groq. A question routed to two specialists costs roughly twice as much.
- Specialists never see each other's answers. Fine for v1 questions; revisit if merged answers conflict.
- Routing quality is measurable on its own: evals include planner routing cases.
- Every run is stored as a trace (planner, specialist, model call, tool call spans with provider, model,
  tokens, and latency), which is how the Gemini quota problem and the 429 fallbacks were found.
