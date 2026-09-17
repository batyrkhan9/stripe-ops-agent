// Card data rendered by the chat and by pages. Built by code from Stripe objects, never by the model.
// No server-only imports: the chat page renders these on the client.

export const PAGES = {
  disputes: { href: "/disputes", label: "Open disputes" },
  recovery: { href: "/recovery", label: "Open recovery" },
  alerts: { href: "/alerts", label: "Open alerts" },
  analytics: { href: "/analytics", label: "Open analytics" },
  actions: { href: "/actions", label: "Open actions" },
} as const;
export type PageName = keyof typeof PAGES;

export type CardAction = { label: string; href: string };

export type DisputeCard = {
  kind: "dispute";
  id: string;
  title: string; // customer name or email
  amount: string;
  reason: string;
  status: string;
  due: string; // "due Sep 25, in 9 days"
  urgent: boolean; // 3 days or less, or overdue
  details: string[]; // "Order KC-10299", "Tracking 1ZKC035897582331"
  action: CardAction;
};

export type InvoiceCard = {
  kind: "invoice";
  id: string;
  title: string;
  amount: string; // amount remaining
  status: string;
  failure: string; // plain English decline reason
  retry: string; // "Retry later" etc
  details: string[];
  urgent: boolean;
  action: CardAction;
};

export type Card = DisputeCard | InvoiceCard;

export type CardsOutput = { cards: Card[]; missing?: string[] };

export type NextAction = { text: string; page: PageName | null; button: CardAction | null };
