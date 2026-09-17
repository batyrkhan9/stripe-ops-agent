"use client";

import { useActionState, useState } from "react";
import { draftEmailAction, type RecoveryFormState } from "@/app/recovery/actions";
import { Button } from "@/components/ui/button";

export function EmailDraft({ invoiceId, email, draftLabel }: { invoiceId: string; email: { subject: string; body: string } | null; draftLabel: string | null }) {
  const [state, draft, drafting] = useActionState<RecoveryFormState, FormData>(draftEmailAction, null);
  const [copied, setCopied] = useState(false);

  return (
    <div className="space-y-2">
      <form action={draft} className="flex items-center gap-3">
        <input type="hidden" name="invoice" value={invoiceId} />
        <Button type="submit" size="sm" variant={email ? "outline" : "default"} disabled={drafting}>
          {drafting ? "Drafting..." : email ? "Redraft email with AI" : "Draft customer email with AI"}
        </Button>
        <span className={state && !state.ok ? "alert-text" : "meta"}>{state?.message ?? draftLabel ?? "Nothing is sent. You copy the email into your own tool."}</span>
      </form>
      {email && (
        <form
          key={draftLabel ?? "email"}
          className="space-y-2"
          onSubmit={async (event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            await navigator.clipboard.writeText(`Subject: ${data.get("subject")}\n\n${data.get("body")}`);
            setCopied(true);
          }}
        >
          <input name="subject" defaultValue={email.subject} className="h-8 w-full rounded-sm border border-input px-2 font-medium" />
          <textarea name="body" defaultValue={email.body} rows={9} className="w-full rounded-sm border border-input px-2 py-1" />
          <div className="flex items-center justify-end gap-3">
            {/\[fill in/i.test(email.body) && <span className="alert-text">Replace the [fill in] parts before sending</span>}
            <Button type="submit" size="sm" variant="outline">
              {copied ? "Copied" : "Copy email"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
