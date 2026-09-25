"use server";

import { revalidatePath } from "next/cache";
import { compileRule } from "@/lib/automations/compiler";
import { runScheduledRules } from "@/lib/automations/schedule";
import { describeRule, ruleSchema, type Rule } from "@/lib/automations/schema";
import { deleteRule, listRules, MAX_RULES, saveRule, setRuleEnabled } from "@/lib/automations/store";
import { getDb } from "@/lib/db";
import { agentModel, finishModel } from "@/lib/llm/provider";
import { getRequestContext } from "@/lib/stripe/request-context";

export type CompileState = { ok: true; sourceText: string; rule: Rule; readback: string; model: string | null } | { ok: false; message: string } | null;
export type RuleActionState = { ok: boolean; message: string } | null;

const scopeOf = (account: Awaited<ReturnType<typeof getRequestContext>>) => ({ accountId: account.accountId, connectionId: account.account.connection?.id ?? null });

// Compiles only; nothing is stored until the merchant reviews the readback and saves.
export async function compileRuleAction(_: CompileState, formData: FormData): Promise<CompileState> {
  const text = String(formData.get("text") ?? "").trim();
  if (text.length < 8) return { ok: false, message: "Describe the rule in a sentence." };
  if (text.length > 300) return { ok: false, message: "Keep it under 300 characters." };
  const result = await compileRule(text, [agentModel, finishModel]);
  if (!result.ok) return result;
  return { ok: true, sourceText: text, rule: result.rule, readback: result.readback, model: result.model };
}

export async function saveRuleAction(_: RuleActionState, formData: FormData): Promise<RuleActionState> {
  const ctx = await getRequestContext();
  const scope = scopeOf(ctx);
  const db = getDb();
  if ((await listRules(db, scope)).length >= MAX_RULES) return { ok: false, message: `At most ${MAX_RULES} rules per account.` };
  // The saved shape is re-validated from the form, never trusted from the client as-is.
  let rule: unknown;
  try {
    rule = JSON.parse(String(formData.get("rule") ?? ""));
  } catch {
    return { ok: false, message: "The compiled rule was malformed. Compile it again." };
  }
  const parsed = ruleSchema.safeParse(rule);
  if (!parsed.success) return { ok: false, message: "The compiled rule is no longer valid. Compile it again." };
  await saveRule(db, scope, { sourceText: String(formData.get("text") ?? "").slice(0, 300), rule: parsed.data, readback: describeRule(parsed.data) });
  revalidatePath("/rules");
  return { ok: true, message: `Saved "${parsed.data.name}".` };
}

export async function toggleRuleAction(_: RuleActionState, formData: FormData): Promise<RuleActionState> {
  const ctx = await getRequestContext();
  const ok = await setRuleEnabled(getDb(), scopeOf(ctx), String(formData.get("id") ?? ""), formData.get("enabled") === "true");
  revalidatePath("/rules");
  return ok ? { ok: true, message: formData.get("enabled") === "true" ? "Enabled." : "Paused." } : { ok: false, message: "Rule not found." };
}

export async function deleteRuleAction(_: RuleActionState, formData: FormData): Promise<RuleActionState> {
  const ctx = await getRequestContext();
  const ok = await deleteRule(getDb(), scopeOf(ctx), String(formData.get("id") ?? ""));
  revalidatePath("/rules");
  return ok ? { ok: true, message: "Deleted." } : { ok: false, message: "Rule not found." };
}

// Runs the daily rules now for the current account: the cron covers the demo account only, because a connected
// account's key is available only inside a request that carries its cookie.
export async function runScheduledNowAction(): Promise<RuleActionState> {
  const { account, accountId, now } = await getRequestContext();
  const scope = { accountId, connectionId: account.connection?.id ?? null };
  const result = await runScheduledRules(
    { db: getDb(), stripe: account.stripe, accountId, mode: account.mode, connectionId: scope.connectionId, permissions: account.connection?.permissions ?? null, now },
    scope,
    "page",
  );
  revalidatePath("/rules");
  return { ok: true, message: result.ran ? `Ran ${result.ran} daily rule${result.ran === 1 ? "" : "s"}, ${result.matched} matched.` : "No daily rules to run." };
}
