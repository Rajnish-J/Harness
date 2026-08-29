ALTER TABLE "workflow_run_steps" ADD COLUMN "duration_ms" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_run_steps" ADD COLUMN "input_tokens" integer;--> statement-breakpoint
ALTER TABLE "workflow_run_steps" ADD COLUMN "output_tokens" integer;