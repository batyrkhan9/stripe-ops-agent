import { sql } from "drizzle-orm";
import { boolean, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

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

// Verified webhook events, deduplicated by Stripe event ID. account_id is null for events on the
// platform's own account (the demo account) and set for Connect accounts.
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
