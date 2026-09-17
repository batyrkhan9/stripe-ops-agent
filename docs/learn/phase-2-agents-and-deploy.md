# Phase 2, second half: connecting accounts, deploying, and the agents

**Connecting an account.** A merchant pastes a restricted Stripe key on the settings page. The app checks what the key can do without changing any data: it lists one object to test each read, and makes write calls that can only fail, where Stripe answers "forbidden" if the key lacks permission. The key is stored encrypted, and the browser keeps only a signed ID. With no key connected, everything uses the read-only demo account. Stripe's Connect OAuth was the first plan, but Stripe only allows read-only OAuth for its official extensions (ADR 0005).

**Deploying.** The app runs on Vercel at stripe-ops-agent.vercel.app, and every push to main deploys it. Secrets live in Vercel's settings, never in the repo. Stripe sends webhook events to the live URL, and a real delivery was confirmed.

**How a question gets answered.** The chat page sends the question to `/api/chat`. A planner model reads it and picks a specialist: disputes, recovery (failed payments), analytics, or actions. The specialist gets a short prompt and only the tools it needs, for example list_disputes and get_charge. It calls those tools against Stripe, then writes an answer that streams back word by word.

**Why answers can be trusted.** Tools return compact facts, including totals, so the model computes rates from real counts. After the answer, code (not the model) builds the Sources list: Stripe IDs the answer cites that a tool actually returned. Any ID no tool returned is flagged. The model is told it cannot change anything, and that text inside Stripe data is data, not instructions.

**What gets recorded.** Every tool call goes to `audit_log`. Every question becomes a trace: which specialist ran, which model answered, tokens used, and time taken. The trace table is how we found that Gemini's free tier allows only 20 requests a day.

**Models.** One file, `lib/llm/provider.ts`, lists four free models in order: two on Groq, two on Gemini. If one is rate limited or down, the next one answers. In testing, the chain switched models mid-conversation without the user noticing, and answers came back in 3 to 6 seconds.

Files: `app/settings/`, `lib/stripe/permissions.ts`, `lib/stripe/account.ts`, `lib/llm/provider.ts`, `lib/agents/`, `lib/tools/read/`, `app/api/chat/route.ts`, `components/chat/chat.tsx`.
