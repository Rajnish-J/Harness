import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

// Next's dev HMR re-evaluates modules on every reload; without caching the pool
// on globalThis you leak one pool per reload until the database refuses
// connections. Neon in particular has a low connection ceiling.
const globalForDb = globalThis as unknown as { __harnessPool?: Pool };

const pool =
  globalForDb.__harnessPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__harnessPool = pool;
}

export const db = drizzle(pool, { schema });
export { schema };
