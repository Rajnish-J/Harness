DROP INDEX "memory_entries_global_slug_uq";--> statement-breakpoint
DROP INDEX "memory_entries_project_slug_uq";--> statement-breakpoint
ALTER TABLE "memory_entries" ADD COLUMN "scoped_session_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "memory_entries_session_slug_uq" ON "memory_entries" USING btree ("scoped_session_id","slug") WHERE "memory_entries"."scoped_session_id" is not null;--> statement-breakpoint
CREATE INDEX "memory_entries_session_archived_idx" ON "memory_entries" USING btree ("scoped_session_id","archived_at");--> statement-breakpoint
CREATE UNIQUE INDEX "memory_entries_global_slug_uq" ON "memory_entries" USING btree ("slug") WHERE "memory_entries"."project_id" is null and "memory_entries"."scoped_session_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "memory_entries_project_slug_uq" ON "memory_entries" USING btree ("project_id","slug") WHERE "memory_entries"."project_id" is not null and "memory_entries"."scoped_session_id" is null;