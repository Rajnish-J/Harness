/**
 * DTOs for a project's environment variables.
 *
 * Same rule as lib/credential-types.ts, with one deliberate exception: a
 * variable marked `secret` has NO field anywhere in this file that carries its
 * plaintext, and `lastFour` is the only trace of it that reaches the browser.
 * A variable marked non-secret does carry `value`, because a hostname or a
 * feature flag you cannot read is a variable you cannot manage — and the
 * operator chose that when they cleared the box.
 *
 * The split is a UI concern only. Both kinds are encrypted at rest with the
 * same key and the same envelope; see db/schema.ts.
 */

import { maskToken } from "./credential-types";

/**
 * A POSIX-ish environment variable name. `.env` files in the wild are laxer,
 * but a key a shell cannot export is a key the container will silently drop, so
 * this is the shape both the import parser and the API route enforce.
 */
export const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function isValidEnvKey(key: string): boolean {
  return ENV_KEY_PATTERN.test(key);
}

export type ProjectEnvVar = {
  id: string;
  projectId: string;
  key: string;
  /** Masked in the UI, and never returned in full. */
  secret: boolean;
  /** The plaintext — `null` whenever `secret` is true. */
  value: string | null;
  lastFour: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
};

/** What the credentials page lists: a variable plus the project it belongs to,
 *  so one flat table can carry a Project column and one grid can group by it. */
export type EnvVarListRow = ProjectEnvVar & {
  projectName: string;
  projectSlug: string;
};

export type EnvVarInput = {
  projectId: string;
  key: string;
  /** Plaintext on the way in only. Encrypted before it reaches the database. */
  value: string;
  secret?: boolean;
  description?: string | null;
};

/** How a value renders wherever it is shown. */
export function displayValue(envVar: ProjectEnvVar): string {
  return envVar.secret ? maskToken(envVar.lastFour) : (envVar.value ?? "");
}

/**
 * Parse pasted `.env` text into entries.
 *
 * Deliberately small, and deliberately not `dotenv`: that package parses a
 * FILE, and pulling a Node-only module in would put this function out of reach
 * of the paste box that wants to preview the result as you type. What it does
 * handle is what people actually paste — comments, blank lines, `export `
 * prefixes, quoted values with `#` inside them, and `\n` escapes in
 * double-quoted values.
 *
 * Later keys win, which is what a shell sourcing the file would do.
 */
export function parseDotenv(text: string): { key: string; value: string }[] {
  const byKey = new Map<string, string>();

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const withoutExport = line.startsWith("export ") ? line.slice(7).trim() : line;
    const eq = withoutExport.indexOf("=");
    if (eq <= 0) continue;

    const key = withoutExport.slice(0, eq).trim();
    if (!isValidEnvKey(key)) continue;

    let value = withoutExport.slice(eq + 1).trim();

    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length > 1) {
      value = value.slice(1, -1);
      // Only double quotes give escapes their usual meaning, same as a shell.
      if (quote === '"') value = value.replace(/\n/g, "\n").replace(/\\"/g, '"');
    } else {
      // Unquoted: a `#` starts a trailing comment. Inside quotes it does not,
      // which is why this runs in the else branch.
      const hash = value.indexOf(" #");
      if (hash >= 0) value = value.slice(0, hash).trim();
    }

    byKey.set(key, value);
  }

  return [...byKey].map(([key, value]) => ({ key, value }));
}
