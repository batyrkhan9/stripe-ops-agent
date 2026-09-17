CREATE TABLE "demo_answers" (
	"key" text PRIMARY KEY NOT NULL,
	"question" text NOT NULL,
	"anchor_at" timestamp with time zone NOT NULL,
	"prompt_version" text NOT NULL,
	"chunks" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
