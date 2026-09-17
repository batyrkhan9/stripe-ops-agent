# Answer format eval results

Run 2026-09-17 07:33 UTC on the demo account. 5 of 5 cases pass every rule.

Rules are checked on the rendered answer. Enforced by code: cards for disputes and invoices, no IDs in cards or
next actions, only the lead paragraph shown when cards are shown, bold kept once, next action and its page button.
Depends on the model: lead length, IDs and ISO dates in text, tables, generic advice, facts, routing.

| Case | Question | Result | Failed rules | Model |
|---|---|---|---|---|
| format-01 | Which disputes need a response? | pass | none | openai/gpt-oss-20b |
| format-02 | Which subscriptions are past due? | pass | none | openai/gpt-oss-20b |
| format-03 | What is our dispute rate over the last 30 days? | pass | none | openai/gpt-oss-20b, gemini-3.5-flash-lite |
| format-04 | Why did payments fail in the last 7 days? | pass | none | openai/gpt-oss-20b, gemini-3.5-flash-lite |
| format-05 | Refund Maya Patel's most recent order | pass | none | openai/gpt-oss-20b |

## Answers

### format-01: Which disputes need a response?

Rendered:

```text
You need to respond to two disputes: one for $65.00 marked “Fraudulent” and one for $28.00 marked “Product not received.” Both are due Sep 25, in 8 days.
```

Model text before rendering:

```text
You need to respond to two disputes: one for $65.00 marked “Fraudulent” and one for $28.00 marked “Product not received.” Both are due Sep 25, in 8 days.

- Fraudulent dispute, order KC‑10299, shipping 1ZKC035897582331  
- Product not received dispute, order KC‑10300, shipping 1ZKC473508949907
```

Cards: Ethan Nguyen $65.00 due Sep 25, in 8 days; Camila Torres $28.00 due Sep 25, in 8 days

Next action: Submit evidence for the $65.00 fraudulent dispute and the $28.00 product not received dispute by September 25. [Open disputes]

### format-02: Which subscriptions are past due?

Rendered:

```text
The following subscriptions are past due: Camila Torres, Arjun Mehta, Owen Davies, Ella Novak, and Tomas Kowalski – each has an open invoice with $15.00 still unpaid.
```

Model text before rendering:

```text
The following subscriptions are past due: Camila Torres, Arjun Mehta, Owen Davies, Ella Novak, and Tomas Kowalski – each has an open invoice with $15.00 still unpaid.

- Past due subscriptions: 5  
- Each latest invoice has 1 payment attempt and a remaining balance of $15.00.
```

Cards: Camila Torres $15.00 The bank declined without giving a reason; Arjun Mehta $15.00 The bank declined without giving a reason; Owen Davies $15.00 The bank declined without giving a reason; Ella Novak $15.00 The bank declined without giving a reason; Tomas Kowalski $15.00 The bank declined without giving a reason

Next action: Send payment recovery emails to Camila Torres, Arjun Mehta, Owen Davies, Ella Novak, and Tomas Kowalski for their $15.00 past-due invoices. [Open recovery]

### format-03: What is our dispute rate over the last 30 days?

Rendered:

```text
Your dispute rate over the last 30 days is 0.65%, based on 2 disputes out of 306 successful charges.
```

Cards: none

Next action: Submit evidence for the two recent disputes from the last 30 days to defend against the charges. [Open disputes]

### format-04: Why did payments fail in the last 7 days?

Rendered:

```text
Payments failed in the last 7 days due to insufficient funds and generic card declines from issuing banks.

* Not enough money in the account: 9 failed payments totaling $483.00 where customers can retry after topping up or use another card.
* The bank declined without giving a reason: 10 failed payments totaling $931.00 where customers must contact their bank or use another card.
```

Cards: none

Next action: Send recovery emails to the customers with failed payments totaling $1,414.00 from the last 7 days. [Open recovery]

### format-05: Refund Maya Patel's most recent order

Rendered:

```text
You requested a refund for Maya Patel’s most recent order of $195.00 (Order KC‑10046 on Sep 11).  
No changes have been made because confirmed actions are not enabled.
```

Cards: none

Next action: Refund $195.00 to Maya Patel for the order on Sep 11 [Open actions]
