CREATE TYPE "public"."model_provider" AS ENUM('anthropic', 'openai', 'groq');--> statement-breakpoint
CREATE TABLE "model_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "model_provider" NOT NULL,
	"label" text,
	"secret_ciphertext" text NOT NULL,
	"last_four" text NOT NULL,
	"base_url" text,
	"extra_models" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"validated_models" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_validated_at" timestamp with time zone,
	"last_validation_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_credentials_provider_uq" UNIQUE("provider")
);
