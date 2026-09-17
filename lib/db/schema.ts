import { sql } from "drizzle-orm";
import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

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
