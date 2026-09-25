import { z } from "zod";

// A compiled automation (spec: Automations, C042, C050, C052, C064). The merchant writes a sentence; the compiler
// turns it into this shape; the merchant reviews the readback before it is saved. Actions can alert, add a brief
// item, draft, or propose a write. There is no "execute" action, so a rule cannot change Stripe (ADR 0003).

export const EVENT_TRIGGERS = ["charge.dispute.created", "payment_intent.payment_failed", "invoice.payment_failed", "charge.refunded", "payment_intent.succeeded"] as const;
export type EventTrigger = (typeof EVENT_TRIGGERS)[number];

// Fields available to conditions, by trigger. Money is in major units (dollars), rates in percent.
export const EVENT_FIELDS: Record<EventTrigger, readonly string[]> = {
  "charge.dispute.created": ["amount", "currency", "dispute_reason", "customer_email"],
  "payment_intent.payment_failed": ["amount", "currency", "decline_reason", "customer_email"],
  "invoice.payment_failed": ["amount", "currency", "attempt_count", "customer_email"],
  "charge.refunded": ["amount", "currency", "customer_email"],
  "payment_intent.succeeded": ["amount", "currency", "customer_email"],
};
export const SCHEDULE_FIELDS = ["chargeback_rate_30d", "decline_rate_7d", "refunds_24h", "failed_invoices", "open_disputes", "mrr", "mrr_net_30d"] as const;

const ALL_FIELDS = [...new Set([...Object.values(EVENT_FIELDS).flat(), ...SCHEDULE_FIELDS])] as [string, ...string[]];

export const conditionSchema = z.object({
  field: z.enum(ALL_FIELDS),
  op: z.enum(["gt", "gte", "lt", "lte", "eq", "neq", "contains"]),
  value: z.union([z.number(), z.string().max(120)]),
});
export type Condition = z.infer<typeof conditionSchema>;

export const triggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("event"), event: z.enum(EVENT_TRIGGERS) }),
  z.object({ type: z.literal("schedule"), cadence: z.literal("daily") }),
]);

// Message templates may use {field} placeholders from the trigger's fields, plus {customer} where the event has one.
export const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("alert"), message: z.string().min(3).max(300) }),
  z.object({ type: z.literal("brief_item"), message: z.string().min(3).max(300) }),
  z.object({ type: z.literal("draft"), kind: z.enum(["recovery_email", "dispute_evidence"]) }),
  z.object({
    type: z.literal("propose"),
    tool: z.enum(["create_refund", "pause_subscription", "cancel_subscription"]),
    params: z.object({ at_period_end: z.boolean().optional(), amount_cents: z.number().int().min(1).optional() }).optional(),
  }),
]);

export const ruleSchema = z
  .object({
    name: z.string().min(3).max(60),
    trigger: triggerSchema,
    conditions: z.array(conditionSchema).max(5),
    action: actionSchema,
  })
  .superRefine((rule, ctx) => {
    const allowed = rule.trigger.type === "event" ? EVENT_FIELDS[rule.trigger.event] : SCHEDULE_FIELDS;
    for (const [i, c] of rule.conditions.entries()) {
      if (!(allowed as readonly string[]).includes(c.field)) ctx.addIssue({ code: "custom", path: ["conditions", i, "field"], message: `${c.field} is not available for this trigger` });
    }
    if (rule.action.type === "draft") {
      const need = rule.action.kind === "recovery_email" ? "invoice.payment_failed" : "charge.dispute.created";
      if (rule.trigger.type !== "event" || rule.trigger.event !== need) ctx.addIssue({ code: "custom", path: ["action"], message: `a ${rule.action.kind} draft needs the ${need} trigger` });
    }
    if (rule.action.type === "propose") {
      const ok: Record<string, EventTrigger[]> = {
        create_refund: ["charge.dispute.created", "payment_intent.succeeded"],
        pause_subscription: ["invoice.payment_failed"],
        cancel_subscription: ["invoice.payment_failed"],
      };
      if (rule.trigger.type !== "event" || !ok[rule.action.tool]!.includes(rule.trigger.event)) {
        ctx.addIssue({ code: "custom", path: ["action"], message: `${rule.action.tool} needs one of: ${ok[rule.action.tool]!.join(", ")}` });
      }
    }
  });
export type Rule = z.infer<typeof ruleSchema>;

export type RuleFields = Record<string, string | number>;

// All conditions must hold. A missing field never matches, so a rule cannot fire on data it did not see.
export function evaluateConditions(conditions: Condition[], fields: RuleFields): boolean {
  return conditions.every((c) => {
    const actual = fields[c.field];
    if (actual === undefined) return false;
    if (c.op === "contains") return String(actual).toLowerCase().includes(String(c.value).toLowerCase());
    if (c.op === "eq") return typeof actual === "number" && typeof c.value === "number" ? actual === c.value : String(actual).toLowerCase() === String(c.value).toLowerCase();
    if (c.op === "neq") return typeof actual === "number" && typeof c.value === "number" ? actual !== c.value : String(actual).toLowerCase() !== String(c.value).toLowerCase();
    const a = Number(actual);
    const b = Number(c.value);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    return c.op === "gt" ? a > b : c.op === "gte" ? a >= b : c.op === "lt" ? a < b : a <= b;
  });
}

// Money placeholders render with a dollar sign; a template that already wrote "${amount}" is not doubled.
export function renderMessage(template: string, fields: RuleFields): string {
  return template
    .replace(/\{(\w+)\}/g, (match, key: string) => {
      const value = fields[key];
      if (value === undefined) return match;
      return key === "amount" || key === "mrr" || key === "mrr_net_30d" ? `$${Number(value).toFixed(2)}` : key.endsWith("_rate_30d") || key.endsWith("_rate_7d") ? `${Number(value).toFixed(2)}%` : String(value);
    })
    .replace(/\$\$(?=\d)/g, "$");
}

const OP_TEXT: Record<Condition["op"], string> = { gt: "is over", gte: "is at least", lt: "is under", lte: "is at most", eq: "is", neq: "is not", contains: "contains" };

// The rule in one sentence, from the typed shape, so the merchant reviews what was compiled and not what the
// model says it compiled.
export function describeRule(rule: Rule): string {
  const when = rule.trigger.type === "event" ? `When ${EVENT_TEXT[rule.trigger.event]}` : "Every day";
  const conditions = rule.conditions.length ? `, if ${rule.conditions.map((c) => `${c.field.replace(/_/g, " ")} ${OP_TEXT[c.op]} ${c.value}`).join(" and ")}` : "";
  const action =
    rule.action.type === "alert"
      ? `alert: "${rule.action.message}"`
      : rule.action.type === "brief_item"
        ? `add to the morning brief: "${rule.action.message}"`
        : rule.action.type === "draft"
          ? `draft a ${rule.action.kind === "recovery_email" ? "customer email" : "dispute evidence"} for the merchant to edit`
          : `propose ${rule.action.tool.replace(/_/g, " ")} for the merchant to confirm`;
  return `${when}${conditions}, ${action}.`;
}

export const EVENT_TEXT: Record<EventTrigger, string> = {
  "charge.dispute.created": "a dispute is opened",
  "payment_intent.payment_failed": "a payment fails",
  "invoice.payment_failed": "an invoice payment fails",
  "charge.refunded": "a charge is refunded",
  "payment_intent.succeeded": "a payment succeeds",
};
