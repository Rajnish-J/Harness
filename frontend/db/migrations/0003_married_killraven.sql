CREATE TYPE "public"."credential_provider" AS ENUM('github', 'azure_devops', 'gitlab', 'generic');--> statement-breakpoint
CREATE TABLE "credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"provider" "credential_provider" DEFAULT 'github' NOT NULL,
	"username" text,
	"secret_ciphertext" text NOT NULL,
	"last_four" text NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_validated_at" timestamp with time zone,
	"last_validation_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credentials_name_uq" UNIQUE("name")
);
