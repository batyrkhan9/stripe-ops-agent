CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"account_id" text NOT NULL,
	"question" text NOT NULL,
	"plan" jsonb,
	"status" text NOT NULL,
	"error" text,
	"latency_ms" integer NOT NULL,
	"sources" jsonb
);
--> statement-breakpoint
CREATE TABLE "trace_spans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"parent_id" uuid,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"provider" text,
	"model_id" text,
	"input" jsonb,
	"output" jsonb,
	"input_tokens" integer,
	"output_tokens" integer,
	"started_at" timestamp with time zone NOT NULL,
	"latency_ms" integer NOT NULL,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "trace_spans" ADD CONSTRAINT "trace_spans_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;