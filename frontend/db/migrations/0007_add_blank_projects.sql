CREATE TYPE "public"."project_kind" AS ENUM('blank', 'github');--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "repo_owner" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "repo_name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "repo_url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "kind" "project_kind" DEFAULT 'github' NOT NULL;