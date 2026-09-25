import type Stripe from "stripe";
import { proposeWrite, type ProposeOutput } from "@/lib/actions/propose";
import { saveProposal, strictAuditWriter } from "@/lib/actions/store";
import { draftEvidence } from "@/lib/agents/disputes/draft";
import { evidenceFacts } from "@/lib/agents/disputes/evidence";
import { draftRecoveryEmail } from "@/lib/agents/recovery/draft";
import { recoveryFacts } from "@/lib/agents/recovery/plan";
import { loadInvoiceDetail } from "@/lib/cards/load";
import type { Db } from "@/lib/db/client";
import { saveDraft } from "@/lib/db/drafts";
import { agentModel, finishModel } from "@/lib/llm/provider";
import type { KeyPermissions } from "@/lib/stripe/permissions";
import { WRITE_TOOLS } from "@/lib/tools/write";
import type { RuleContext } from "./context";
import { evaluateConditions, renderMessage, type Rule } from "./schema";
import { recordRun, type RuleScope } from "./store";

export type RuleOutcome =
  | { type: "alert"; message: string }
  | { type: "brief_item"; message: string }
  | { type: "draft"; kind: "recovery_email" | "dispute_evidence"; targetId: string }
  | { type: "proposal"; status: ProposeOutput["status"]; proposalId?: string; message: string }
  | { type: "skipped"; reason: string };

export type ExecutorDeps = {
  db: Db;
  stripe: Stripe;
  accountId: string;
  mode: "demo" | "connected";
  connectionId: string | null;
  permissions: KeyPermissions | null;
  now: number;
  // Injectable for tests; defaults call the real proposal and draft paths.
  propose?: (tool: keyof typeof WRITE_TOOLS, input: unknown) => Promise<ProposeOutput>;
  draft?: (kind: "recovery_email" | "dispute_evidence", targetId: string) => Promise<void>;
};

// Runs one rule against one context. Alert and brief_item outcomes are just stored messages; draft calls the same
// drafting code as the pages; propose goes through proposeWrite, so a rule can never execute a write (ADR 0003).
export async function runRule(rule: Rule, ctx: RuleContext, deps: ExecutorDeps): Promise<{ matched: boolean; outcome: RuleOutcome | null }> {
  if (rule.trigger.type === "event" ? ctx.kind !== "event" || ctx.event !== rule.trigger.event : ctx.kind !== "schedule") return { matched: false, outcome: null };
  if (!evaluateConditions(rule.conditions, ctx.fields)) return { matched: false, outcome: null };
  const action = rule.action;
  if (action.type === "alert" || action.type === "brief_item") return { matched: true, outcome: { type: action.type, message: renderMessage(action.message, ctx.fields) } };
  if (ctx.kind !== "event") return { matched: true, outcome: { type: "skipped", reason: "drafts and proposals need an event with a target" } };
  if (action.type === "draft") {
    const targetId = action.kind === "recovery_email" ? ctx.targets.invoice : ctx.targets.dispute;
    if (!targetId) return { matched: true, outcome: { type: "skipped", reason: "the event carried no target for the draft" } };
    await (deps.draft ?? defaultDraft(deps))(action.kind, targetId);
    return { matched: true, outcome: { type: "draft", kind: action.kind, targetId } };
  }
  const input =
    action.tool === "create_refund"
      ? { charge_id: ctx.targets.charge, amount_cents: action.params?.amount_cents }
      : { subscription_id: ctx.targets.subscription, ...(action.tool === "cancel_subscription" ? { at_period_end: action.params?.at_period_end ?? true } : {}) };
  if (!("charge_id" in input ? input.charge_id : input.subscription_id)) return { matched: true, outcome: { type: "skipped", reason: "the event carried no target for the proposal" } };
  const output = await (deps.propose ?? defaultPropose(deps))(action.tool, input);
  return {
    matched: true,
    outcome: { type: "proposal", status: output.status, proposalId: output.status === "proposed" ? output.proposal_id : undefined, message: output.status === "proposed" ? output.summary : output.message },
  };
}

function defaultPropose(deps: ExecutorDeps) {
  return (tool: keyof typeof WRITE_TOOLS, input: unknown) =>
    proposeWrite(WRITE_TOOLS[tool], input, {
      stripe: deps.stripe,
      now: deps.now,
      agent: "automation",
      accountId: deps.accountId,
      mode: deps.mode,
      connectionId: deps.connectionId,
      permissions: deps.permissions,
      saveProposal: (proposal) => saveProposal(deps.db, proposal),
      // Best effort like the read audit: this only records a proposal, the write itself is audited strictly at confirm.
      audit: (record) => strictAuditWriter(deps.db, deps.accountId)(record).catch((error: unknown) => console.error("automation audit failed", error)),
    });
}

function defaultDraft(deps: ExecutorDeps) {
  return async (kind: "recovery_email" | "dispute_evidence", targetId: string) => {
    const chains = [finishModel, agentModel];
    if (kind === "recovery_email") {
      const detail = await loadInvoiceDetail(deps.stripe, targetId, deps.now);
      const { email, served } = await draftRecoveryEmail(recoveryFacts(detail.invoice, detail.declineCode, detail.lastAttempt), deps.now, chains);
      await saveDraft(deps.db, { accountId: deps.accountId, kind: "recovery_plan", targetId, content: { email, automation: true }, provider: served?.provider, modelId: served?.modelId });
      return;
    }
    const dispute = await deps.stripe.disputes.retrieve(targetId, { expand: ["charge.customer"] });
    const charge = typeof dispute.charge === "string" ? null : dispute.charge;
    const customerId = typeof charge?.customer === "string" ? charge.customer : charge?.customer?.id;
    const history = customerId ? (await deps.stripe.charges.list({ customer: customerId, limit: 100 })).data : [];
    const facts = evidenceFacts(dispute, deps.now, history);
    const draft = await draftEvidence(facts, chains);
    await saveDraft(deps.db, { accountId: deps.accountId, kind: "dispute_evidence", targetId, content: { fields: draft.fields, facts, automation: true }, provider: draft.served?.provider, modelId: draft.served?.modelId });
  };
}

// Runs every enabled rule for the scope against one context and records each run. Errors in one rule never stop
// the others.
export async function runRules(
  rules: { id: string; rule: unknown }[],
  ctx: RuleContext,
  deps: ExecutorDeps,
  scope: RuleScope,
  trigger: "webhook" | "cron" | "page",
): Promise<{ ran: number; matched: number }> {
  let matched = 0;
  for (const row of rules) {
    const rule = row.rule as Rule;
    try {
      const result = await runRule(rule, ctx, deps);
      if (result.matched) matched++;
      // Unmatched event runs are not recorded: a busy account would fill the history with "did not match" rows.
      if (result.matched || ctx.kind === "schedule") {
        await recordRun(deps.db, { ruleId: row.id, accountId: scope.accountId, trigger, eventId: ctx.kind === "event" ? ctx.eventId : null, matched: result.matched, outcome: result.outcome });
      }
    } catch (error) {
      await recordRun(deps.db, { ruleId: row.id, accountId: scope.accountId, trigger, eventId: ctx.kind === "event" ? ctx.eventId : null, matched: true, outcome: null, error: (error instanceof Error ? error.message : String(error)).slice(0, 300) }).catch(() => undefined);
    }
  }
  return { ran: rules.length, matched };
}
