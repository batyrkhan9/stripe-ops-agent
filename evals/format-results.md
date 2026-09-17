# Answer format eval results

Run 2026-09-17 08:07 UTC on the demo account. 4 of 5 cases pass every rule.

Rules are checked on the rendered answer. Enforced by code: cards for disputes and invoices, no IDs in cards or
next actions, only the lead paragraph shown when cards are shown, bold kept once, next action and its page button.
Depends on the model: lead length, IDs and ISO dates in text, tables, generic advice, facts, routing.

| Case | Question | Result | Failed rules | Model |
|---|---|---|---|---|
| format-01 | Which disputes need a response? | pass | none | openai/gpt-oss-120b, openai/gpt-oss-20b |
| format-02 | Which subscriptions are past due? | fail | lead_one_or_two_sentences: lead has 3 sentences: "Three customers have past‑due subscriptions: Camila Torres, Arjun Mehta, and Owen Davies. Their next billing date is Oct 17, and each has an open invoice with $" | openai/gpt-oss-20b |
| format-03 | What is our dispute rate over the last 30 days? | pass | none | openai/gpt-oss-20b |
| format-04 | Why did payments fail in the last 7 days? | pass | none | openai/gpt-oss-20b, gemini-3.5-flash-lite |
| format-05 | Refund Maya Patel's most recent order | pass | none | openai/gpt-oss-20b, gemini-3.5-flash-lite |

## Answers

### format-01: Which disputes need a response?

Rendered:

```text
You have two open disputes that need a response.
```

Model text before rendering:

```text
You have two open disputes that need a response:

- Fraudulent charge of $65.00 from Ethan Nguyen (due Sep 25, in 8 days)
- Product not received claim of $28.00 from Camila Torres (due Sep 25, in 8 days)

- Both are in “needs_response” status
- Neither has evidence submitted yet
- Each dispute references the same order_id and shipping_tracking you already have for the charge.
```

Cards: Ethan Nguyen $65.00 due Sep 25, in 8 days; Camila Torres $28.00 due Sep 25, in 8 days

Next action: Submit evidence for Ethan Nguyen's $65.00 dispute and Camila Torres's $28.00 dispute before September 25. [Open disputes]

### format-02: Which subscriptions are past due?

Rendered:

```text
Three customers have past‑due subscriptions: Camila Torres, Arjun Mehta, and Owen Davies. Their next billing date is Oct 17, and each has an open invoice with $15.00 still due, meaning the card was declined or insufficient for the charge. If the card can be re‑authorized—perhaps after the customer tops up or changes the card—re‑attempting the payment should resolve the status; otherwise ask the customer to update their payment info.
```

Model text before rendering:

```text
Three customers have past‑due subscriptions: Camila Torres, Arjun Mehta, and Owen Davies. Their next billing date is Oct 17, and each has an open invoice with $15.00 still due, meaning the card was declined or insufficient for the charge. If the card can be re‑authorized—perhaps after the customer tops up or changes the card—re‑attempting the payment should resolve the status; otherwise ask the customer to update their payment info.  

- Camila Torres – $15.00 due on Oct 17  
- Arjun Mehta – $15.00 due on Oct 17  
- Owen Davies – $15.00 due on Oct 17
```

Cards: Camila Torres $15.00 The bank declined without giving a reason; Arjun Mehta $15.00 The bank declined without giving a reason; Owen Davies $15.00 The bank declined without giving a reason; Ella Novak $15.00 The bank declined without giving a reason; Tomas Kowalski $15.00 The bank declined without giving a reason

Next action: Retry payment for Camila Torres, Arjun Mehta, and Owen Davies. [Open recovery]

### format-03: What is our dispute rate over the last 30 days?

Rendered:

```text
You have a dispute rate of 0.65% over the last 30 days.
```

Model text before rendering:

```text
You have a dispute rate of 0.65% over the last 30 days.

- 306 successful charges, 2 disputed  
- 2 / 306 = 0.0065 → 0.65%
```

Cards: Chargeback rate 0.65% Last 30 days

Next action: Submit evidence for the two disputed charges to defend against the chargebacks. [Open alerts]

### format-04: Why did payments fail in the last 7 days?

Rendered:

```text
Payments failed in the last 7 days due to insufficient funds and bank-declined transactions, with each issue requiring the customer to either top up their account, use another card, or contact their bank.

* Not enough money in the account: 9 failures
* The bank declined without giving a reason: 10 failures
```

Cards: none

Next action: Review smart retries and update customer email settings for the failed payments. [Open recovery]

### format-05: Refund Maya Patel's most recent order

Rendered:

```text
I have proposed a full refund of $195.00 for Maya Patel for the order from Sep 11, which needs to be confirmed on the Actions page.
```

Cards: Refund $195.00 to Maya Patel for the Sep 11 charge (order KC-10046)  

Next action: Confirm the full refund of $195.00 for Maya Patel from Sep 11 [Open actions]
