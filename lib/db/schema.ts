import { sql } from "drizzle-orm";
import { boolean, doublePrecision, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { KeyPermissions } from "@/lib/stripe/permissions";

export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  accountId: text("account_id").notNull(),
  agent: text("agent").notNull(),
  tool: text("tool").notNull(),
  params: jsonb("params").notNull(),
  stripeIds: text("stripe_ids").array().notNull().default(sql`'{}'::text[]`),
  result: jsonb("result"),
});

// One row per chat request: the planner's routing and the outcome. Spans hold the steps inside it.
export const agentRuns = pgTable("agent_runs", {
  id: uuid("id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  accountId: text("account_id").notNull(),
  question: text("question").notNull(),
  plan: jsonb("plan"),
  status: text("status").notNull(),
  error: text("error"),
  latencyMs: integer("latency_ms").notNull(),
  sources: jsonb("sources"),
});

export const traceSpans = pgTable("trace_spans", {
  id: uuid("id").primaryKey(),
  runId: uuid("run_id").notNull().references(() => agentRuns.id, { onDelete: "cascade" }),
  parentId: uuid("parent_id"),
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  provider: text("provider"),
  modelId: text("model_id"),
  input: jsonb("input"),
  output: jsonb("output"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  latencyMs: integer("latency_ms").notNull(),
  error: text("error"),
});

// A merchant's pasted restricted key (ADR 0005). The key is encrypted at rest and cleared on disconnect.
// The browser holds only a signed connection ID cookie.
export const connections = pgTable("connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  keyCiphertext: text("key_ciphertext"),
  keyLast4: text("key_last4").notNull(),
  accountId: text("account_id"),
  permissions: jsonb("permissions").$type<KeyPermissions>().notNull(),
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull(),
  disconnectedAt: timestamp("disconnected_at", { withTimezone: true }),
});

// Verified webhook events, deduplicated by Stripe event ID. account_id is null for events on the demo
// account itself and set only if Stripe sends an event on behalf of another account.
export const stripeEvents = pgTable("stripe_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  accountId: text("account_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  payload: jsonb("payload").notNull(),
});

// One row per seed run. In demo mode, "now" is anchor_at of the latest completed run (ADR 0001).
export const seedRuns = pgTable("seed_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: text("account_id").notNull(),
  anchorAt: timestamp("anchor_at", { withTimezone: true }).notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  spike: boolean("spike").notNull().default(false),
  counts: jsonb("counts"),
});

// Intended dates for seeded Stripe objects. kind is "created" for every object, plus
// "failed" or "canceled" for subscriptions that reached those states.
export const seededObjects = pgTable(
  "seeded_objects",
  {
    stripeId: text("stripe_id").notNull(),
    kind: text("kind").notNull().default("created"),
    accountId: text("account_id").notNull(),
    objectType: text("object_type").notNull(),
    seedKey: text("seed_key").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.stripeId, table.kind] })],
);

// Demo-mode answers to the questions in lib/demo/questions.ts, stored as the UI stream chunks of one clean run.
// The key hashes the question, the demo anchor, and the prompt version, so reseeding or changing a prompt
// makes old rows unreachable instead of wrong.
export const demoAnswers = pgTable("demo_answers", {
  key: text("key").primaryKey(),
  question: text("question").notNull(),
  anchorAt: timestamp("anchor_at", { withTimezone: true }).notNull(),
  promptVersion: text("prompt_version").notNull(),
  chunks: jsonb("chunks").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Alert rules that fired (lib/alerts), one row per rule per account per day of "now" (demo time in demo mode).
export const alertEvents = pgTable(
  "alert_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: text("account_id").notNull(),
    rule: text("rule").notNull(),
    dayKey: text("day_key").notNull(),
    severity: text("severity").notNull(),
    value: doublePrecision("value").notNull(),
    valueLabel: text("value_label").notNull(),
    summary: text("summary").notNull(),
    stripeIds: text("stripe_ids").array().notNull().default(sql`'{}'::text[]`),
    firstTrigger: text("first_trigger").notNull(),
    lastTrigger: text("last_trigger").notNull(),
    evaluations: integer("evaluations").notNull().default(1),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("alert_events_account_rule_day").on(table.accountId, table.rule, table.dayKey)],
);

// Writes proposed by an agent or a page (ADR 0003). Nothing in Stripe changes until a merchant confirms in the UI;
// status moves proposed -> executing -> executed or failed, or proposed -> canceled. The executing step is claimed
// with a conditional update so a double click cannot run a write twice.
export const proposedActions = pgTable("proposed_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  accountId: text("account_id").notNull(),
  connectionId: uuid("connection_id"),
  mode: text("mode").notNull(),
  agent: text("agent").notNull(),
  tool: text("tool").notNull(),
  permission: text("permission").notNull(),
  params: jsonb("params").notNull(),
  summary: text("summary").notNull(),
  details: text("details").array().notNull().default(sql`'{}'::text[]`),
  confirmLabel: text("confirm_label").notNull(),
  targetIds: text("target_ids").array().notNull().default(sql`'{}'::text[]`),
  status: text("status").notNull().default("proposed"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  result: jsonb("result"),
  error: text("error"),
});

// Agent drafts a merchant edits before using: dispute evidence and recovery emails. Never sent by themselves.
export const drafts = pgTable("drafts", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  accountId: text("account_id").notNull(),
  kind: text("kind").notNull(),
  targetId: text("target_id").notNull(),
  content: jsonb("content").notNull(),
  provider: text("provider"),
  modelId: text("model_id"),
});
