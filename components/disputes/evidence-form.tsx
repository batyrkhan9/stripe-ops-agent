"use client";

import { useActionState } from "react";
import { draftEvidenceAction, proposeEvidenceAction, type DisputeFormState } from "@/app/disputes/actions";
import { Button } from "@/components/ui/button";
import { EVIDENCE_FIELDS, EVIDENCE_LABELS, type EvidenceField } from "@/lib/tools/write/submit-dispute-evidence";

const ROWS: Partial<Record<EvidenceField, number>> = { product_description: 3, uncategorized_text: 9, refund_policy_disclosure: 2 };
const FIELDS = EVIDENCE_FIELDS.map((name) => ({ name, label: EVIDENCE_LABELS[name], rows: ROWS[name] ?? 1 }));

export function EvidenceForm({ disputeId, fields, draftLabel }: { disputeId: string; fields: Record<string, string> | null; draftLabel: string | null }) {
  const [draftState, draft, drafting] = useActionState<DisputeFormState, FormData>(draftEvidenceAction, null);
  const [proposeState, propose, proposing] = useActionState<DisputeFormState, FormData>(proposeEvidenceAction, null);

  return (
    <div className="space-y-3">
      <form action={draft} className="flex items-center gap-3">
        <input type="hidden" name="dispute" value={disputeId} />
        <Button type="submit" size="sm" variant={fields ? "outline" : "default"} disabled={drafting}>
          {drafting ? "Drafting..." : fields ? "Redraft with AI" : "Draft evidence with AI"}
        </Button>
        <span className="meta">{draftState?.message ?? draftLabel ?? "Facts come from Stripe; the AI writes the narrative. You edit before anything is proposed."}</span>
      </form>

      {fields && (
        // Keyed by the draft so a new draft replaces what is in the text boxes.
        <form action={propose} className="space-y-2" key={draftLabel ?? "draft"}>
          <input type="hidden" name="dispute" value={disputeId} />
          {FIELDS.map((field) => {
            const value = fields[field.name] ?? "";
            const needsInput = /\[fill in/i.test(value);
            return (
              <label key={field.name} className="grid grid-cols-[12rem_minmax(0,1fr)] items-start gap-3">
                <span className={`pt-1 ${needsInput ? "alert-text" : "label normal-case tracking-normal"}`}>{field.label}</span>
                {field.rows > 1 ? (
                  <textarea name={field.name} defaultValue={value} rows={field.rows} className="w-full rounded-sm border border-input px-2 py-1" />
                ) : (
                  <input name={field.name} defaultValue={value} className="h-8 w-full rounded-sm border border-input px-2" />
                )}
              </label>
            );
          })}
          <div className="flex items-center justify-end gap-3 border-t pt-2">
            {proposeState && <span className={proposeState.ok ? "meta" : "alert-text"}>{proposeState.message}</span>}
            <Button type="submit" size="sm" disabled={proposing}>
              {proposing ? "Checking..." : "Propose submission"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
