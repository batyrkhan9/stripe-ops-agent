# Decisions made while away

Started 2026-09-17. Each entry says what was decided, why, and how to reverse it.

| # | Decision | Why | To reverse |
|---|---|---|---|
| 1 | Queue order follows your message: analytics (CLAUDE.md Phase 4), then evals, safety cases, and benchmark (CLAUDE.md Phase 7), then README, docs/workflow.md, and ADR 0004. Morning brief, automations (Phase 5), and API/CLI (Phase 6) are not built in this session. | You listed "Phase 5 evals"; CLAUDE.md numbers evals as Phase 7. The queue you wrote is explicit about content, so content wins over numbering. | Build Phase 5 and 6 next; nothing here depends on skipping them. |
