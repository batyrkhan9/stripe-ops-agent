import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { Card } from "@/lib/cards/types";

// Dense bordered rows, shared by chat answers and pages. Urgent rows use the accent rule; nothing else does.
export function CardRow({ card }: { card: Card }) {
  const secondary = card.kind === "dispute" ? card.reason : card.failure;
  const timing = card.kind === "dispute" ? card.due : card.retry;
  return (
    <div className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 border-b py-2 pr-1 pl-2 ${card.urgent ? "alert-row" : "border-l-2 border-l-transparent"}`}>
      <div className="min-w-0 space-y-0.5">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <span className="font-medium">{card.title}</span>
          <span className="num font-medium">{card.amount}</span>
          {secondary && <span className="text-muted-foreground">{secondary}</span>}
          <span className="meta">{card.status}</span>
        </div>
        {timing && <div className={card.urgent ? "alert-text" : ""}>{timing}</div>}
        {card.details.length > 0 && <div className="meta">{card.details.join(" · ")}</div>}
      </div>
      <Button asChild size="sm" variant={card.urgent ? "default" : "outline"}>
        <Link href={card.action.href}>{card.action.label}</Link>
      </Button>
    </div>
  );
}

export function CardList({ cards, title }: { cards: Card[]; title?: string }) {
  if (cards.length === 0) return null;
  return (
    <div>
      {title && (
        <div className="label border-b border-strong-border px-2 pb-1">
          {title} ({cards.length})
        </div>
      )}
      {cards.map((card) => (
        <CardRow key={card.id} card={card} />
      ))}
    </div>
  );
}
