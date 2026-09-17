// Decline codes in plain English, with whether a retry can work and what the customer must do.
// Source: docs.stripe.com/declines/codes. Unknown codes fall back to a generic explanation.

export type DeclineExplanation = { meaning: string; retry: "soon" | "later" | "no"; customerAction: string };

const EXPLANATIONS: Record<string, DeclineExplanation> = {
  insufficient_funds: { meaning: "Not enough money in the account", retry: "later", customerAction: "Top up the account or use another card" },
  generic_decline: { meaning: "The bank declined without giving a reason", retry: "later", customerAction: "Call the bank or use another card" },
  do_not_honor: { meaning: "The bank declined without giving a reason", retry: "later", customerAction: "Call the bank or use another card" },
  card_declined: { meaning: "The card was declined", retry: "later", customerAction: "Use another card" },
  expired_card: { meaning: "The card has expired", retry: "no", customerAction: "Update the card on file" },
  incorrect_cvc: { meaning: "The security code was wrong", retry: "no", customerAction: "Re-enter card details" },
  processing_error: { meaning: "Temporary error at the bank or network", retry: "soon", customerAction: "Nothing, a retry usually works" },
  lost_card: { meaning: "The card was reported lost", retry: "no", customerAction: "Use another card" },
  stolen_card: { meaning: "The card was reported stolen", retry: "no", customerAction: "Use another card" },
  card_velocity_exceeded: { meaning: "Card limit or spending velocity reached", retry: "later", customerAction: "Wait, or use another card" },
  fraudulent: { meaning: "The bank suspects fraud", retry: "no", customerAction: "Contact the bank" },
  highest_risk_level: { meaning: "Blocked as high risk by Stripe Radar", retry: "no", customerAction: "Use another payment method" },
  authentication_required: { meaning: "The bank requires customer authentication", retry: "no", customerAction: "Complete 3D Secure in a new checkout" },
};

export function explainDecline(code: string | null | undefined): DeclineExplanation {
  return (
    (code ? EXPLANATIONS[code] : undefined) ?? {
      meaning: code ? `Declined (${code.replace(/_/g, " ")})` : "Payment failed",
      retry: "later",
      customerAction: "Use another card",
    }
  );
}
