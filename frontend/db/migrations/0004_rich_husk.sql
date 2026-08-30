CREATE TYPE "public"."clone_status" AS ENUM('pending', 'cloning', 'ready', 'error');--> statement-breakpoint
CREATE TABLE "project_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"path" text NOT NULL,
	"dir_path" text DEFAULT '' NOT NULL,
	"name" text NOT NULL,
	"ext" text,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"is_binary" boolean DEFAULT false NOT NULL,
	"git_blob_sha" text,
	"indexed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_files_project_path_uq" UNIQUE("project_id","path")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"provider" "credential_provider" DEFAULT 'github' NOT NULL,
	"repo_owner" text NOT NULL,
	"repo_name" text NOT NULL,
	"repo_url" text NOT NULL,
	"repo_id" text,
	"default_branch" text DEFAULT 'main' NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"credential_id" uuid,
	"clone_status" "clone_status" DEFAULT 'pending' NOT NULL,
	"clone_error" text,
	"current_branch" text,
	"last_pulled_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_slug_uq" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "project_files" ADD CONSTRAINT "project_files_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_credential_id_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."credentials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_files_project_dir_idx" ON "project_files" USING btree ("project_id","dir_path");--> statement-breakpoint
CREATE INDEX "projects_archived_updated_idx" ON "projects" USING btree ("archived_at","updated_at");