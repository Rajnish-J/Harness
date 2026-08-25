CREATE TYPE "public"."run_status" AS ENUM('queued', 'running', 'completed', 'error', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."step_status" AS ENUM('running', 'ok', 'error', 'skipped', 'cancelled');--> statement-breakpoint
CREATE TABLE "workflow_run_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"node_id" text NOT NULL,
	"node_type" text NOT NULL,
	"label" text,
	"seq" integer NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"status" "step_status" DEFAULT 'running' NOT NULL,
	"input" text,
	"output" text,
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tool_call_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "workflow_run_steps_run_node_attempt_uq" UNIQUE("run_id","node_id","attempt")
);
--> statement-breakpoint
CREATE TABLE "workflow_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"workflow_version" integer NOT NULL,
	"thread_id" text NOT NULL,
	"status" "run_status" DEFAULT 'queued' NOT NULL,
	"cancel_requested" boolean DEFAULT false NOT NULL,
	"input" text NOT NULL,
	"graph_snapshot" jsonb NOT NULL,
	"final_state" jsonb,
	"error" text,
	"done_reason" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"graph" jsonb DEFAULT '{"nodes":[],"edges":[]}'::jsonb NOT NULL,
	"graph_version" integer DEFAULT 1 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflow_run_steps" ADD CONSTRAINT "workflow_run_steps_run_id_workflow_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflow_run_steps_run_seq_idx" ON "workflow_run_steps" USING btree ("run_id","seq");--> statement-breakpoint
CREATE INDEX "workflow_runs_workflow_started_idx" ON "workflow_runs" USING btree ("workflow_id","started_at");--> statement-breakpoint
CREATE INDEX "workflow_runs_thread_idx" ON "workflow_runs" USING btree ("thread_id");