CREATE TABLE "drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"account_id" text NOT NULL,
	"kind" text NOT NULL,
	"target_id" text NOT NULL,
	"content" jsonb NOT NULL,
	"provider" text,
	"model_id" text
);
--> statement-breakpoint
CREATE TABLE "proposed_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"account_id" text NOT NULL,
	"connection_id" uuid,
	"mode" text NOT NULL,
	"agent" text NOT NULL,
	"tool" text NOT NULL,
	"permission" text NOT NULL,
	"params" jsonb NOT NULL,
	"summary" text NOT NULL,
	"details" text[] DEFAULT '{}'::text[] NOT NULL,
	"confirm_label" text NOT NULL,
	"target_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"decided_at" timestamp with time zone,
	"result" jsonb,
	"error" text
);
