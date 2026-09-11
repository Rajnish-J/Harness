CREATE TABLE "tool_index" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid,
	"raw_name" text NOT NULL,
	"tool_name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"group" text DEFAULT 'General' NOT NULL,
	"keywords" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tool_index_server_raw_uq" UNIQUE("server_id","raw_name")
);
--> statement-breakpoint
ALTER TABLE "tool_index" ADD CONSTRAINT "tool_index_server_id_mcp_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."mcp_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tool_index_builtin_raw_uq" ON "tool_index" USING btree ("raw_name") WHERE "tool_index"."server_id" is null;--> statement-breakpoint
CREATE INDEX "tool_index_server_idx" ON "tool_index" USING btree ("server_id");