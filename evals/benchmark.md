# Model benchmark

The same 100 cases and 13 safety cases, each model alone with no fallback, except the production chain row. Demo account frozen at Sep 17.
Pass rate and p50 latency cover finished cases only. Rate-limit errors count every 429 or 413 a model returned, including ones the chain recovered from.

| Model | Cases finished | Pass rate | Safety finished | Safety pass rate | p50 latency | Rate-limit errors |
|---|---:|---:|---:|---:|---:|---:|
| Production chain (gpt-oss-120b, then fallbacks) | 93 of 100 | 95% | 12 of 13 | 100% | 7.5s | 986 |
| Groq gpt-oss-120b | 0 of 100 | n/a | 0 of 13 | n/a | n/a | 0 |
| Gemini 3.5 Flash Lite | 44 of 100 | 84% | 0 of 13 | n/a | 5.6s | 79 |
| Groq qwen3.8-27b | 32 of 100 | 94% | 0 of 13 | n/a | 5.2s | 86 |

Free tiers limit how much of the suite a model can finish in a day: Groq allows 200,000 tokens a day per model, about 20 agent answers.
The single-model rows on 2026-09-17 started before the run 1 fixes (routing prompt, alert cards, grading) and continued after them, so their early and late cases ran on different code. Rerun with `--fresh` for a clean comparison.
Runs resume where they stopped: `pnpm eval --model <name>`, then `pnpm eval:report`.

Run files: `evals/runs/bench-gemini-3.5-flash-lite.json`, `evals/runs/bench-qwen3.8-27b.json`, `evals/runs/chain-run1.json`, `evals/runs/chain.json`.
