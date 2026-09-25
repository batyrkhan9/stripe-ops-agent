"use client";

import { useActionState } from "react";
import { compileRuleAction, saveRuleAction, type CompileState, type RuleActionState } from "@/app/rules/actions";
import { Button } from "@/components/ui/button";

const EXAMPLES = [
  "Alert me when a dispute over $50 is opened",
  "Draft a customer email whenever an invoice payment fails",
  "Add a line to my morning brief if the decline rate is over 15%",
  "Propose pausing the subscription when an invoice fails for the third time",
];

export function RuleForm() {
  const [compiled, compile, compiling] = useActionState<CompileState, FormData>(compileRuleAction, null);
  const [saved, save, saving] = useActionState<RuleActionState, FormData>(saveRuleAction, null);

  return (
    <div className="space-y-3">
      <form action={compile} className="space-y-2">
        <textarea name="text" rows={2} maxLength={300} placeholder="Describe a rule in plain English" className="w-full rounded-sm border border-input px-2 py-1" defaultValue={compiled?.ok ? compiled.sourceText : undefined} />
        <div className="flex items-center gap-3">
          <Button type="submit" size="sm" disabled={compiling}>
            {compiling ? "Compiling..." : "Compile rule"}
          </Button>
          <span className="meta">The AI turns it into a typed rule; you review the result before it is saved.</span>
        </div>
      </form>
      {compiled === null && (
        <ul className="meta space-y-0.5">
          {EXAMPLES.map((e) => (
            <li key={e}>Try: {e}</li>
          ))}
        </ul>
      )}
      {compiled && !compiled.ok && <p className="alert-text">{compiled.message}</p>}
      {compiled?.ok && (
        <form action={save} className="space-y-2 border-l-2 border-strong-border pl-3">
          <div className="label">Compiled rule</div>
          <p className="font-medium">{compiled.readback}</p>
          <pre className="stripe-id max-h-48 overflow-auto bg-muted p-2">{JSON.stringify(compiled.rule, null, 2)}</pre>
          <input type="hidden" name="rule" value={JSON.stringify(compiled.rule)} />
          <input type="hidden" name="text" value={compiled.sourceText} />
          <div className="flex items-center gap-3">
            <Button type="submit" size="sm" disabled={saving || saved?.ok === true}>
              {saving ? "Saving..." : saved?.ok ? "Saved" : "Save this rule"}
            </Button>
            <span className={saved && !saved.ok ? "alert-text" : "meta"}>{saved?.message ?? (compiled.model ? `Compiled by ${compiled.model}. A rule can alert, add a brief line, draft, or propose; it never changes Stripe by itself.` : "")}</span>
          </div>
        </form>
      )}
    </div>
  );
}
