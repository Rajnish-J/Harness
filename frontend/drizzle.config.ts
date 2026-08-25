import { config } from "dotenv";

// drizzle-kit does NOT read .env.local the way Next.js does — without this the
// DATABASE_URL is undefined and every command fails with a confusing error.
config({ path: ".env.local" });

import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dbCredentials: { url: process.env.DATABASE_URL! },
  // LangGraph owns checkpoints/checkpoint_blobs/checkpoint_writes/
  // checkpoint_migrations and creates them itself. Without this filter,
  // drizzle-kit sees tables it doesn't know about and proposes DROPping them.
  tablesFilter: ["workflows", "workflow_runs", "workflow_run_steps"],
  verbose: true,
  strict: true,
});
