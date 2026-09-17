"use client";

import { useActionState } from "react";
import { writeNarrativeAction, type NarrativeState } from "@/app/analytics/actions";
import { Button } from "@/components/ui/button";

export type StoredNarrative = { text: string; unverified: string[]; sources: string[]; label: string };

export function Narrative({ narrative }: { narrative: StoredNarrative | null }) {
  const [state, write, writing] = useActionState<NarrativeState>(writeNarrativeAction, null);
  return (
    <div className="space-y-2">
      {narrative ? <p className="max-w-3xl text-[1rem] leading-relaxed">{narrative.text}</p> : <p className="meta">No narrative yet for this date.</p>}
      {narrative && narrative.unverified.length > 0 && (
        <p className="alert-text">Not found in the metrics, check before relying on: {narrative.unverified.join(", ")}</p>
      )}
      <div className="flex items-center gap-3">
        <form action={write}>
          <Button type="submit" size="sm" variant={narrative ? "outline" : "default"} disabled={writing}>
            {writing ? "Writing..." : narrative ? "Rewrite narrative" : "Write narrative with AI"}
          </Button>
        </form>
        <span className={state && !state.ok ? "alert-text" : "meta"}>{state?.message ?? narrative?.label ?? "Written only from the numbers on this page, and checked against them."}</span>
      </div>
      {narrative && (
        <details className="meta">
          <summary className="cursor-pointer select-none">Sources ({narrative.sources.length} Stripe objects)</summary>
          <p className="stripe-id mt-1 break-all pl-3">{narrative.sources.join("  ") || "The narrative cites computed totals only."}</p>
        </details>
      )}
    </div>
  );
}
