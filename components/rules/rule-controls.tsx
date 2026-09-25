"use client";

import { useActionState } from "react";
import { deleteRuleAction, runScheduledNowAction, toggleRuleAction, type RuleActionState } from "@/app/rules/actions";
import { Button } from "@/components/ui/button";

export function RuleControls({ id, enabled }: { id: string; enabled: boolean }) {
  const [toggleState, toggle, toggling] = useActionState<RuleActionState, FormData>(toggleRuleAction, null);
  const [deleteState, remove, deleting] = useActionState<RuleActionState, FormData>(deleteRuleAction, null);
  const state = toggleState ?? deleteState;
  return (
    <div className="flex items-center justify-end gap-2">
      {state && !state.ok && <span className="alert-text">{state.message}</span>}
      <form action={toggle}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="enabled" value={enabled ? "false" : "true"} />
        <Button type="submit" size="sm" variant="outline" disabled={toggling || deleting}>
          {enabled ? "Pause" : "Enable"}
        </Button>
      </form>
      <form action={remove}>
        <input type="hidden" name="id" value={id} />
        <Button type="submit" size="sm" variant="outline" disabled={toggling || deleting}>
          Delete
        </Button>
      </form>
    </div>
  );
}

export function RunNowButton() {
  const [state, run, running] = useActionState<RuleActionState>(runScheduledNowAction, null);
  return (
    <form action={run} className="flex items-center gap-3">
      <Button type="submit" size="sm" variant="outline" disabled={running}>
        {running ? "Running..." : "Run daily rules now"}
      </Button>
      {state && <span className={state.ok ? "meta" : "alert-text"}>{state.message}</span>}
    </form>
  );
}
