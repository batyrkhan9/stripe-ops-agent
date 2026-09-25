CREATE TABLE "automation_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"account_id" text NOT NULL,
	"connection_id" uuid,
	"name" text NOT NULL,
	"source_text" text NOT NULL,
	"rule" jsonb NOT NULL,
	"readback" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "automation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rule_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"trigger" text NOT NULL,
	"event_id" text,
	"matched" boolean NOT NULL,
	"outcome" jsonb,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "briefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"day_key" text NOT NULL,
	"content" jsonb NOT NULL,
	"summary_model" text,
	"trigger" text NOT NULL,
	"emailed_to" text,
	"emailed_at" timestamp with time zone,
	"email_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_rule_id_automation_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."automation_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "briefs_account_day" ON "briefs" USING btree ("account_id","day_key");