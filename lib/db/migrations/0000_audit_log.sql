CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"account_id" text NOT NULL,
	"agent" text NOT NULL,
	"tool" text NOT NULL,
	"params" jsonb NOT NULL,
	"stripe_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"result" jsonb
);
