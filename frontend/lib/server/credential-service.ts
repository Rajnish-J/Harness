/**
 * Drizzle access for the credential vault.
 *
 * Same shape as registry-service.ts — lazy getDb(), `.returning()` on writes,
 * `row ?? null` on single-row reads — with one addition that matters: every
 * read goes through `toCredential()`, which builds the DTO field by field and
 * has no branch that can emit `secretCiphertext`. Selecting `*` and spreading
 * it would put the ciphertext one careless `NextResponse.json(row)` away from
 * the browser; naming the columns means the leak cannot be written by accident.
 *
 * Encryption happens here rather than in the route handlers, so there is
 * exactly one place a plaintext token turns into a stored one.
 */

import { desc, eq } from "drizzle-orm";

import { getDb } from "@/db";
import { credentials, type CredentialRow } from "@/db/schema";
import type { Credential, CredentialInput } from "@/lib/credential-types";
import { encryptSecret, lastFourOf } from "@/lib/server/crypto";

/** The row -> DTO boundary. The secret has no path through this function. */
function toCredential(row: CredentialRow): Credential {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    username: row.username,
    lastFour: row.lastFour,
    scopes: row.scopes,
    enabled: row.enabled,
    lastValidatedAt: row.lastValidatedAt?.toISOString() ?? null,
    lastValidationError: row.lastValidationError,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listCredentials(): Promise<Credential[]> {
  const rows = await getDb()
    .select()
    .from(credentials)
    .orderBy(desc(credentials.updatedAt));
  return rows.map(toCredential);
}

export async function getCredential(id: string): Promise<Credential | null> {
  const [row] = await getDb()
    .select()
    .from(credentials)
    .where(eq(credentials.id, id))
    .limit(1);
  return row ? toCredential(row) : null;
}

export async function createCredential(
  input: CredentialInput & { secret: string },
): Promise<Credential> {
  const [row] = await getDb()
    .insert(credentials)
    .values({
      name: input.name,
      provider: input.provider ?? "github",
      username: input.username ?? null,
      secretCiphertext: encryptSecret(input.secret),
      lastFour: lastFourOf(input.secret),
      scopes: [],
      enabled: input.enabled ?? true,
    })
    .returning();
  return toCredential(row!);
}

export async function updateCredential(
  id: string,
  patch: Partial<CredentialInput>,
): Promise<Credential | null> {
  // An absent `secret` means "leave the stored token alone" — the editor cannot
  // show the current one, so it submits the field only when replacing it.
  // A present-but-empty one would encrypt to a useless credential, so the route
  // rejects it before we get here.
  const secretColumns =
    patch.secret !== undefined && patch.secret !== ""
      ? {
          secretCiphertext: encryptSecret(patch.secret),
          lastFour: lastFourOf(patch.secret),
          // The old token's scopes and validation verdict describe a token that
          // no longer exists. Clearing them makes the UI say "not tested yet"
          // rather than vouching for the new one on the strength of the old.
          scopes: [] as string[],
          lastValidatedAt: null,
          lastValidationError: null,
        }
      : {};

  const [row] = await getDb()
    .update(credentials)
    .set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.provider !== undefined ? { provider: patch.provider } : {}),
      ...(patch.username !== undefined ? { username: patch.username } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...secretColumns,
      updatedAt: new Date(),
    })
    .where(eq(credentials.id, id))
    .returning();
  return row ? toCredential(row) : null;
}

export async function deleteCredential(id: string) {
  // Hard delete, like the other registries. `projects.credential_id` references
  // this table with ON DELETE SET NULL, so a project whose credential is removed
  // survives — it just cannot sync until one is re-linked.
  const [row] = await getDb()
    .delete(credentials)
    .where(eq(credentials.id, id))
    .returning({ id: credentials.id });
  return row ?? null;
}

/** Record the verdict from a "Test connection" run. */
export async function recordValidation(
  id: string,
  result: { username: string | null; scopes: string[]; error: string | null },
): Promise<Credential | null> {
  const [row] = await getDb()
    .update(credentials)
    .set({
      // A successful test is the only reliable source of the account name, so
      // it backfills a username the operator never had to type.
      ...(result.username ? { username: result.username } : {}),
      scopes: result.scopes,
      lastValidatedAt: new Date(),
      lastValidationError: result.error,
      updatedAt: new Date(),
    })
    .where(eq(credentials.id, id))
    .returning();
  return row ? toCredential(row) : null;
}
