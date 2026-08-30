import { config } from "dotenv";

// drizzle-kit does NOT read the env files the way Next.js does — without this
// the DATABASE_URL is undefined and every command fails with a confusing error.
// Same precedence Next.js uses: .env.local wins over .env, because dotenv keeps
// the first value it sees for a key.
config({ path: [".env.local", ".env"] });

import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dbCredentials: { url: process.env.DATABASE_URL! },
  // LangGraph owns checkpoints/checkpoint_blobs/checkpoint_writes/
  // checkpoint_migrations and creates them itself. Without this filter,
  // drizzle-kit sees tables it doesn't know about and proposes DROPping them.
  tablesFilter: [
    "workflows",
    "workflow_runs",
    "workflow_run_steps",
    "mcp_servers",
    "skills",
    "agents",
    // This list is an allowlist, not just a LangGraph exclusion: a table added
    // to schema.ts but not named here is silently never migrated.
    "credentials",
    "projects",
    "project_files",
    "project_containers",
    "project_chat_sessions",
    "project_chat_messages",
  ],
  verbose: true,
  strict: true,
});
