/**
 * Turn a database failure into something a human can act on.
 *
 * Drizzle wraps every driver error in a `DrizzleQueryError` whose message is
 * the SQL text plus `params:` — the real cause (ECONNREFUSED, a missing table,
 * a bad password) is buried in `.cause`. Rendering that message straight into
 * the UI produces the useless "Failed query: select ... params:" banner, so
 * every user-facing catch around a query goes through here instead.
 */

/** Node/libpq attach `code` to the error; pg puts SQLSTATE there too. */
type DriverError = Error & { code?: string; address?: string; port?: number };

function rootCause(error: unknown): DriverError {
  let current = error as DriverError;
  // DrizzleQueryError -> pg error -> (sometimes) an AggregateError from the
  // socket layer. Walk to the deepest link that still carries a message.
  while (current?.cause instanceof Error) {
    current = current.cause as DriverError;
  }
  return current;
}

function target(): string {
  const url = process.env.DATABASE_URL;
  if (!url) return "the database";
  try {
    const { hostname, port, pathname } = new URL(url);
    return `${hostname}:${port || "5432"}${pathname}`;
  } catch {
    return "the database";
  }
}

/**
 * A short, actionable sentence for a failed query. Safe to show in the UI: it
 * never includes the connection string's credentials or the SQL text.
 */
export function describeDbError(error: unknown): string {
  if (!process.env.DATABASE_URL) {
    return (
      "DATABASE_URL is not set. Copy frontend/.env.example to .env.local and " +
      "point DATABASE_URL at your Postgres instance."
    );
  }

  const cause = rootCause(error);

  switch (cause?.code) {
    case "ECONNREFUSED":
      return `Cannot reach Postgres at ${target()} — nothing is listening. Start the database (or fix DATABASE_URL) and reload.`;
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return `Cannot resolve the database host in DATABASE_URL (${target()}).`;
    case "ETIMEDOUT":
      return `Timed out connecting to Postgres at ${target()}.`;
    case "28P01":
    case "28000":
      return "Postgres rejected the credentials in DATABASE_URL.";
    case "3D000":
      return `The database named in DATABASE_URL does not exist (${target()}). Create it, then run \`npm run db:migrate\`.`;
    case "42P01":
      return "The application tables are missing. Run `npm run db:migrate` in frontend/ to apply the Drizzle migrations.";
    case "42703":
      return "The application tables are out of date. Run `npm run db:migrate` in frontend/ to apply the latest migration.";
    default:
      return cause?.message || "Unknown database error.";
  }
}

/**
 * Same message, but the untouched error is logged first so the SQL text and
 * stack are still available in the server terminal. Route handlers and server
 * components use this — the UI gets the short sentence, the operator gets the
 * detail.
 */
export function reportDbError(context: string, error: unknown): string {
  console.error(`[db] ${context}`, error);
  return describeDbError(error);
}
