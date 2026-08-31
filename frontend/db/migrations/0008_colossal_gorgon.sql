ALTER TABLE "project_chat_messages" ALTER COLUMN "project_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "project_chat_sessions" ALTER COLUMN "project_id" DROP NOT NULL;