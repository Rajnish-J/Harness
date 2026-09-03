CREATE TYPE "public"."memory_kind" AS ENUM('preference', 'feedback', 'fact', 'reference');--> statement-breakpoint
CREATE TABLE "memory_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"kind" "memory_kind" NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"source" text DEFAULT 'agent' NOT NULL,
	"session_id" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "memory_entries" ADD CONSTRAINT "memory_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "memory_entries_global_slug_uq" ON "memory_entries" USING btree ("slug") WHERE "memory_entries"."project_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "memory_entries_project_slug_uq" ON "memory_entries" USING btree ("project_id","slug") WHERE "memory_entries"."project_id" is not null;--> statement-breakpoint
CREATE INDEX "memory_entries_project_archived_idx" ON "memory_entries" USING btree ("project_id","archived_at");