# Phase 4: revenue analytics

**What it shows.** The Analytics page answers "how is the business doing" with four numbers at the top: MRR, the net change in MRR over 30 days (new subscriptions against cancellations), churn over 30 days, and gross volume. Below them are a weekly MRR chart, a cohort table (of the subscriptions that started each month, how many are still paying), and decline rates by card brand and by card country.

**Math in code, not in the model.** Every number comes from small functions in `lib/analytics/metrics.ts` that take a list of subscriptions or charges and a date, and return a result. They have unit tests with hand-checked answers. The AI never calculates anything here.

**Where the data comes from.** `lib/analytics/load.ts` reads all subscriptions and 90 days of charges from Stripe. Demo objects carry their intended dates in metadata (ADR 0001), so September's numbers stay the same no matter when you look. Experiment leftovers from early testing are skipped.

**The narrative.** A button asks the analytics agent to write three or four sentences about the numbers. It sees only a text version of the metrics, formatted exactly as the page shows them. Afterwards, code checks every dollar amount and percentage in the narrative against that text and warns about any it cannot find. Its Sources are the subscriptions that started or were canceled in the last 30 days.

**Chat uses the same numbers.** A new read tool, `get_metrics`, gives the chat's analytics agent these exact figures, so "what is our MRR?" in chat matches the page.

**Honest limits.** MRR counts each subscription at its current price, so plan upgrades are not split out. Stripe only documents decline test cards for Visa in the US, so in the demo every decline is Visa, US. The page says both.

Files: `lib/analytics/`, `lib/agents/analytics/narrative.ts`, `lib/tools/read/get-metrics.ts`, `app/analytics/`, `components/analytics/`.
