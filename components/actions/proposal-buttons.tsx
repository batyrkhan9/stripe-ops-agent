"use client";

import { useActionState } from "react";
import { cancelAction, confirmAction, type ActionFormState } from "@/app/actions/actions";
import { Button } from "@/components/ui/button";

// Confirm and Cancel for one pending proposal. The label says exactly what confirming does.
export function ProposalButtons({ id, confirmLabel, demo }: { id: string; confirmLabel: string; demo: boolean }) {
  const [confirmState, confirm, confirming] = useActionState<ActionFormState, FormData>(confirmAction, null);
  const [cancelState, cancel, canceling] = useActionState<ActionFormState, FormData>(cancelAction, null);
  const state = confirmState ?? cancelState;
  return (
    <div className="space-y-1 text-right">
      <div className="flex justify-end gap-2">
        <form action={cancel}>
          <input type="hidden" name="proposal" value={id} />
          <Button type="submit" size="sm" variant="outline" disabled={canceling || confirming}>
            Cancel
          </Button>
        </form>
        <form action={confirm}>
          <input type="hidden" name="proposal" value={id} />
          <Button type="submit" size="sm" disabled={demo || confirming || canceling} title={demo ? "The demo account is read-only" : undefined}>
            {confirming ? "Confirming..." : confirmLabel}
          </Button>
        </form>
      </div>
      {demo && <p className="meta">Demo account: read-only, cannot confirm</p>}
      {state && <p className={state.ok ? "meta" : "alert-text"}>{state.message}</p>}
    </div>
  );
}
