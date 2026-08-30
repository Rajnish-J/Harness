CREATE TYPE "public"."chat_role" AS ENUM('user', 'assistant', 'tool_call', 'tool_result', 'error');--> statement-breakpoint
CREATE TABLE "project_chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"session_id" text NOT NULL,
	"seq" integer NOT NULL,
	"role" "chat_role" NOT NULL,
	"content" text,
	"tool_name" text,
	"tool_call_id" text,
	"tool_args" jsonb,
	"is_error" boolean DEFAULT false NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_chat_messages_session_seq_uq" UNIQUE("session_id","seq")
);
--> statement-breakpoint
CREATE TABLE "project_chat_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"session_id" text NOT NULL,
	"provider" text NOT NULL,
	"history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_chat_sessions_session_uq" UNIQUE("session_id")
);
--> statement-breakpoint
ALTER TABLE "project_chat_messages" ADD CONSTRAINT "project_chat_messages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_chat_sessions" ADD CONSTRAINT "project_chat_sessions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_chat_messages_session_seq_idx" ON "project_chat_messages" USING btree ("session_id","seq");--> statement-breakpoint
CREATE INDEX "project_chat_sessions_project_idx" ON "project_chat_sessions" USING btree ("project_id","updated_at");