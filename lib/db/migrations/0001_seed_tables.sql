CREATE TABLE "seed_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"anchor_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"spike" boolean DEFAULT false NOT NULL,
	"counts" jsonb
);
--> statement-breakpoint
CREATE TABLE "seeded_objects" (
	"stripe_id" text NOT NULL,
	"kind" text DEFAULT 'created' NOT NULL,
	"account_id" text NOT NULL,
	"object_type" text NOT NULL,
	"seed_key" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "seeded_objects_stripe_id_kind_pk" PRIMARY KEY("stripe_id","kind")
);
