import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

// Next's dev HMR re-evaluates modules on every reload; without caching the pool
// on globalThis you leak one pool per reload until the database refuses
// connections. Neon in particular has a low connection ceiling.
const globalForDb = globalThis as unknown as {
  __harnessPool?: Pool;
  __harnessDb?: NodePgDatabase<typeof schema>;
  __harnessDbUrl?: string;
};

/**
 * Build the pool on first query, not at import time.
 *
 * Doing this eagerly means a misconfigured DATABASE_URL throws while the route
 * module is being imported, which is outside every caller's try/catch — the
 * page 500s instead of rendering its error banner. Lazily, the same throw lands
 * inside the query call where it can be caught and described.
 */
export function getDb(): NodePgDatabase<typeof schema> {
  // With no connectionString, `pg` silently falls back to PG* env vars and then
  // to a libpq default of the OS username on localhost — so a missing
  // DATABASE_URL surfaces as a confusing auth or "database does not exist"
  // error against a database nobody meant to touch. Fail on the real problem.
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy frontend/.env.example to .env.local and " +
        "point DATABASE_URL at your Postgres instance.",
    );
  }

  // Keying the cache on the URL matters: `next dev` reloads .env in place
  // without restarting the process, so a pool cached under the old credentials
  // would keep failing long after the value was fixed.
  if (globalForDb.__harnessDb && globalForDb.__harnessDbUrl === connectionString) {
    return globalForDb.__harnessDb;
  }

  // Drain the superseded pool rather than leaking its sockets.
  void globalForDb.__harnessPool?.end().catch(() => {});

  const pool = new Pool({
    connectionString,
    max: 5,
    // Default is "wait forever". An unreachable host should surface as an error
    // banner in a few seconds, not a request that hangs.
    connectionTimeoutMillis: 5_000,
  });

  // A pool-level error (server restarted, idle client killed) is emitted on the
  // pool, and an unhandled 'error' event takes down the Node process.
  pool.on("error", (error) => {
    console.error("[db] idle client error", error);
  });

  const db = drizzle(pool, { schema });

  globalForDb.__harnessPool = pool;
  globalForDb.__harnessDb = db;
  globalForDb.__harnessDbUrl = connectionString;
  return db;
}

export { schema };
