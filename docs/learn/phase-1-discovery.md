# Phase 1: Discovery

**What was built.** No code. A list of 77 real complaints from merchants running businesses on Stripe, grouped into 5 pains, plus a one-page product spec.

**Why.** To build from real problems instead of guesses. Every feature in the spec names the complaint IDs it answers, so anyone can check that a feature solves something a merchant actually said.

**How the complaints were collected.** Searches on Reddit r/stripe, WordPress.org plugin forums, Hacker News, X, and GitHub. Each complaint is one row in `complaints.csv`: link, date, a short paraphrase, and a tag. `evidence.csv` holds a word-for-word quote from each page, and every quote was matched against the live page to prove the complaint exists. Posts selling a tool and posts older than three years were removed.

**The 5 pains.** Disputes are costly and easy to lose (21). Account holds and support dead ends (18). Failed payments and confusing declines (17). Numbers that do not reconcile (15). Fraud noticed too late (6). A second count leaves out 18 WooCommerce forum rows, because the plugin causes part of those pains. The ranking stays the same.

**How it connects to the spec.** v1 targets the four pains a tool on the merchant's side can act on, 59 of 77 complaints. Account holds are Stripe's own risk decisions, so they are out of scope. Alerts still help indirectly, by keeping a merchant's dispute and refund rates under the thresholds that trigger holds. Customer 360 is built last because the fewest complaints support it.

**How success is measured.** Every open dispute has complete evidence ready at least 3 days before its deadline. Complaint C061 lost a winnable case only because the deadline was missed. Banks decide who wins, so the product aims at what a merchant controls: getting complete evidence in on time.

Files: `docs/discovery/complaints.csv`, `evidence.csv`, `clusters.md`, `docs/spec.md`.
