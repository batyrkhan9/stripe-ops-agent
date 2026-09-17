import type Stripe from "stripe";
import { redactSecrets } from "@/lib/tools/format";
import type { AuditRecord } from "@/lib/tools/types";
import type { KeyPermissions } from "@/lib/stripe/permissions";
import { ProposalRejected, type ProposalDescription, type WriteToolDefinition } from "@/lib/tools/write/types";

export type NewProposal = ProposalDescription & {
  accountId: string;
  connectionId: string | null;
  mode: "demo" | "connected";
  agent: string;
  tool: string;
  permission: string;
  params: unknown;
};

export type ProposeContext = {
  stripe: Stripe;
  now: number;
  agent: string;
  accountId: string;
  mode: "demo" | "connected";
  connectionId: string | null;
  // Stored permissions of a connected key; null in demo mode.
  permissions: KeyPermissions | null;
  saveProposal: (proposal: NewProposal) => Promise<string>;
  audit: (record: AuditRecord) => Promise<void>;
};

export type ProposeOutput =
  | { status: "proposed"; proposal_id: string; summary: string; details: string[]; confirm_label: string; target_ids: string[]; demo: boolean; note: string }
  | { status: "refused"; reason: "read_only_key"; message: string }
  | { status: "rejected"; message: string }
  | { status: "error"; error: string; message: string };

// Runs when an agent (or a page) calls a write tool. It never changes Stripe data: it validates the input, refuses if
// the connected key cannot write this resource, reads the target to describe the change, and stores a proposal the
// merchant confirms on the Actions page. Demo mode still stores the proposal so the flow is visible, but confirming
// it is refused.
export async function proposeWrite(definition: WriteToolDefinition, rawInput: unknown, ctx: ProposeContext): Promise<ProposeOutput> {
  const parsed = definition.input.safeParse(rawInput);
  let output: ProposeOutput;
  let targetIds: string[] = [];
  if (!parsed.success) {
    output = { status: "error", error: "invalid_input", message: parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") };
  } else if (ctx.mode === "connected" && !ctx.permissions?.write[definition.permission]) {
    output = {
      status: "refused",
      reason: "read_only_key",
      message: `The connected key cannot write ${definition.permission}, so no action was proposed. Grant Write on ${definition.permission} to a restricted key and reconnect in Settings.`,
    };
  } else {
    try {
      const description = await definition.describe(parsed.data, { stripe: ctx.stripe, now: ctx.now });
      targetIds = description.targetIds;
      const proposalId = await ctx.saveProposal({
        ...description,
        accountId: ctx.accountId,
        connectionId: ctx.connectionId,
        mode: ctx.mode,
        agent: ctx.agent,
        tool: definition.name,
        permission: definition.permission,
        params: parsed.data,
      });
      output = {
        status: "proposed",
        proposal_id: proposalId,
        summary: description.summary,
        details: description.details,
        confirm_label: description.confirmLabel,
        target_ids: description.targetIds,
        demo: ctx.mode === "demo",
        note:
          ctx.mode === "demo"
            ? "Nothing has changed. This is the read-only demo account, so the proposal can be reviewed but not confirmed."
            : "Nothing has changed yet. The merchant must confirm this on the Actions page.",
      };
    } catch (error) {
      output =
        error instanceof ProposalRejected
          ? { status: "rejected", message: error.message }
          : {
              status: "error",
              error: (error as { code?: string }).code ?? "error",
              message: redactSecrets(error instanceof Error ? error.message : String(error)),
            };
    }
  }
  await ctx.audit({ agent: ctx.agent, tool: definition.name, params: rawInput, stripeIds: targetIds, result: output });
  return output;
}
