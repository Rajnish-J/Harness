CREATE TYPE "public"."container_status" AS ENUM('creating', 'running', 'stopped', 'error', 'removed');--> statement-breakpoint
CREATE TABLE "project_containers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"container_id" text,
	"container_name" text NOT NULL,
	"image" text NOT NULL,
	"status" "container_status" DEFAULT 'creating' NOT NULL,
	"host_port" integer,
	"workspace_path" text,
	"error" text,
	"started_at" timestamp with time zone,
	"stopped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_containers_project_uq" UNIQUE("project_id")
);
--> statement-breakpoint
ALTER TABLE "project_containers" ADD CONSTRAINT "project_containers_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_containers_status_idx" ON "project_containers" USING btree ("status");