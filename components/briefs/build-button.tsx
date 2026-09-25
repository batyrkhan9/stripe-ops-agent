"use client";

import { useActionState } from "react";
import { buildBriefAction, type BriefFormState } from "@/app/briefs/actions";
import { Button } from "@/components/ui/button";

export function BuildBriefButton({ label }: { label: string }) {
  const [state, build, building] = useActionState<BriefFormState>(buildBriefAction, null);
  return (
    <form action={build} className="flex items-center gap-3">
      <Button type="submit" size="sm" variant="outline" disabled={building}>
        {building ? "Building..." : label}
      </Button>
      {state && <span className={state.ok ? "meta" : "alert-text"}>{state.message}</span>}
    </form>
  );
}
