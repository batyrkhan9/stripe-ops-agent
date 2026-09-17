# Discovery: merchant pain clusters

80 complaints from real merchants operating on Stripe, collected 2026-09-16.
Raw data: [complaints.csv](complaints.csv). Verbatim proof fragments: [evidence.csv](evidence.csv).

## Method

- Sources: Reddit r/stripe (35), WordPress.org plugin support forums (21), Hacker News (13), X (5),
  GitHub issues (4), Indie Hackers (2). Dates range from 2023-06-13 to 2026-09-15.
- Every row was checked against its source page: the verbatim fragment in evidence.csv was matched
  as an exact string against the fetched page content.
- Excluded: posts where the author was pitching their own tool (5 rows), vendor lead-generation threads,
  and GitHub issues written by plugin maintainers.
- Each complaint is assigned to exactly one cluster, by its primary pain.

## Clusters

| # | Pain | Count | Share |
|---|------|------:|------:|
| P1 | Disputes are expensive, opaque, and easy to lose | 23 | 29% |
| P2 | Account risk decisions, payout holds, and support dead ends | 18 | 23% |
| P3 | Failed payments and confusing declines leak recurring revenue | 17 | 21% |
| P4 | Numbers do not reconcile and answers are hard to get out of the data | 15 | 19% |
| P5 | Fraud and anomalies are noticed too late | 7 | 9% |

### P1. Disputes are expensive, opaque, and easy to lose (23)

Merchants lose disputes even with strong proof, miss evidence deadlines, and find the evidence
upload tedious. Fees apply whether they win or lose, so fighting small disputes rarely pays, and won
disputes still count toward the dispute rate.

IDs: C001, C003, C015, C020, C023, C030, C031, C035, C037, C041, C045, C046, C055, C061, C063, C068,
C069, C071, C072, C075, C078, C079, C080

Sharpest signals: deadline missed on a winnable case (C061), evidence work is tedious (C037),
proof exists but is hard to present (C072, C075), no path to respond to an inquiry (C080),
refunded payments still disputed (C063, C078).

### P2. Account risk decisions, payout holds, and support dead ends (18)

Payouts paused or accounts closed as high risk, funds held for months, and support replies that do
not explain why. Also fee increases and inability to migrate away.

IDs: C005, C010, C011, C012, C017, C025, C026, C029, C033, C036, C039, C049, C056, C057, C065,
C073, C076, C077

Largest non-dispute pain, but it is driven by Stripe's own risk and support decisions. A merchant-side
agent cannot fix it. Out of scope for v1 (see docs/spec.md). C065 shows the link to P1 and P5: a small
rise in disputes led to a reserve.

### P3. Failed payments and confusing declines leak recurring revenue (17)

Decline codes like do_not_honor and generic_decline give no actionable reason. Renewals fail silently,
retries hit dead payment methods, past-due subscriptions linger for years, and nobody gets notified.

IDs: C008, C021, C024, C027, C034, C040, C042, C043, C044, C047, C050, C051, C052, C053, C054,
C058, C059

Sharpest signals: codes nobody can explain (C021, C024, C034, C058), no notification when renewals
stall (C052), unclear what to do with long past-due subscriptions (C042, C050).

### P4. Numbers do not reconcile and answers are hard to get out of the data (15)

MRR in the dashboard cannot be reproduced or pulled through the API, payouts do not map to invoices,
refunds arrive late and break reports, and searching for a payment returns nothing.

IDs: C004, C009, C013, C014, C016, C018, C019, C022, C032, C060, C062, C066, C067, C070, C074

Sharpest signals: MRR not reproducible (C019, C060), MRR not in the API (C018), search fails to
find a disputed payment (C062). Several rows (C004, C009, C013, C032, C066) are plugin sync bugs,
not Stripe data problems, and are out of scope.

### P5. Fraud and anomalies are noticed too late (7)

Card testing and fraud waves run for days or months before anyone looks: noticed only by eyeballing
signups, or only when dispute emails arrive. A dispute rate can jump inside a single week.

IDs: C002, C006, C007, C028, C038, C048, C064

Smallest cluster by count, but the most costly per incident (C006, C028). Related signals in other
clusters: sudden decline spike (C047), reserve after a dispute rise (C065).

## Caveats

- Public complaint channels over-represent angry and extreme cases. Counts show which pains come up
  often, not how many merchants have them.
- 21 rows come from WooCommerce plugin forums, so some pains are partly caused by the plugin.
- r/SaaS searches did not complete because of rate limits, and Stack Overflow was not searched.
  X is thin (5 rows).
- 3 rows are older than three years (C001, C002, C003).
