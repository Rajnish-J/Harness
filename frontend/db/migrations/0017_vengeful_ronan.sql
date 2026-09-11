CREATE TYPE "public"."feedback_vote" AS ENUM('up', 'down');--> statement-breakpoint
CREATE TABLE "message_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" text NOT NULL,
	"message_uid" text NOT NULL,
	"vote" "feedback_vote" NOT NULL,
	"note" text,
	"memory_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_feedback_message_uq" UNIQUE("message_uid")
);
--> statement-breakpoint
ALTER TABLE "project_chat_messages" ADD COLUMN "message_uid" text;--> statement-breakpoint
ALTER TABLE "message_feedback" ADD CONSTRAINT "message_feedback_memory_id_memory_entries_id_fk" FOREIGN KEY ("memory_id") REFERENCES "public"."memory_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "message_feedback_session_idx" ON "message_feedback" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_chat_messages_uid_uq" ON "project_chat_messages" USING btree ("message_uid");