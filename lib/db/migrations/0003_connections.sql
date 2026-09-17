CREATE TABLE "connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"key_ciphertext" text,
	"key_last4" text NOT NULL,
	"account_id" text,
	"permissions" jsonb NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"disconnected_at" timestamp with time zone
);
