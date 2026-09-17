CREATE TABLE "alert_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"rule" text NOT NULL,
	"day_key" text NOT NULL,
	"severity" text NOT NULL,
	"value" double precision NOT NULL,
	"value_label" text NOT NULL,
	"summary" text NOT NULL,
	"stripe_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"first_trigger" text NOT NULL,
	"last_trigger" text NOT NULL,
	"evaluations" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "alert_events_account_rule_day" ON "alert_events" USING btree ("account_id","rule","day_key");