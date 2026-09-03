/**
 * Drizzle access for the LLM provider key vault.
 *
 * A near-mirror of credential-service.ts, and for the same reasons: every read
 * goes through `toModelCredential()`, which builds the DTO field by field and
 * has no branch that can emit `secretCiphertext`. Selecting `*` and spreading it
 * would put the ciphertext one careless `NextResponse.json(row)` away from the
 * browser; naming the columns means the leak cannot be written by accident.
 *
 * Encryption happens here rather than in the route handlers, so there is exactly
 * one place a plaintext key turns into a stored one — and it is the same
 * `encryptSecret` the PAT vault uses, not a second envelope.
 */

import { asc, eq } from "drizzle-orm";

import { getDb } from "@/db";
import { modelCredentials, type ModelCredentialRow } from "@/db/schema";
import type {
  ModelCredential,
  ModelCredentialInput,
} from "@/lib/model-credential-types";
import { encryptSecret, lastFourOf } from "@/lib/server/crypto";

/** The row -> DTO boundary. The secret has no path through this function. */
function toModelCredential(row: ModelCredentialRow): ModelCredential {
  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    lastFour: row.lastFour,
    baseUrl: row.baseUrl,
    extraModels: row.extraModels,
    enabled: row.enabled,
    validatedModels: row.validatedModels,
    lastValidatedAt: row.lastValidatedAt?.toISOString() ?? null,
    lastValidationError: row.lastValidationError,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Ordered by provider rather than by recency, unlike the other registries. There
 * is at most one row per provider, so this list is short, fixed and read as a
 * checklist of "which providers do I have set up" — a stable order is worth more
 * than surfacing whichever one was touched last.
 */
export async function listModelCredentials(): Promise<ModelCredential[]> {
  const rows = await getDb()
    .select()
    .from(modelCredentials)
    .orderBy(asc(modelCredentials.provider));
  return rows.map(toModelCredential);
}

export async function getModelCredential(
  id: string,
): Promise<ModelCredential | null> {
  const [row] = await getDb()
    .select()
    .from(modelCredentials)
    .where(eq(modelCredentials.id, id))
    .limit(1);
  return row ? toModelCredential(row) : null;
}

export async function createModelCredential(
  input: ModelCredentialInput & { secret: string },
): Promise<ModelCredential> {
  const [row] = await getDb()
    .insert(modelCredentials)
    .values({
      provider: input.provider,
      label: input.label ?? null,
      secretCiphertext: encryptSecret(input.secret),
      lastFour: lastFourOf(input.secret),
      baseUrl: input.baseUrl ?? null,
      extraModels: input.extraModels ?? [],
      enabled: input.enabled ?? true,
      validatedModels: [],
    })
    .returning();
  return toModelCredential(row!);
}

export async function updateModelCredential(
  id: string,
  patch: Partial<ModelCredentialInput>,
): Promise<ModelCredential | null> {
  // An absent `secret` means "leave the stored key alone" — the editor cannot
  // show the current one, so it submits the field only when replacing it. A
  // present-but-empty one would encrypt to a useless credential, so the route
  // rejects it before we get here.
  const secretColumns =
    patch.secret !== undefined && patch.secret !== ""
      ? {
          secretCiphertext: encryptSecret(patch.secret),
          lastFour: lastFourOf(patch.secret),
          // The old key's verdict describes a key that no longer exists.
          // Clearing it makes the UI say "not tested yet" rather than vouching
          // for the new one on the strength of the old.
          validatedModels: [] as string[],
          lastValidatedAt: null,
          lastValidationError: null,
        }
      : {};

  const [row] = await getDb()
    .update(modelCredentials)
    .set({
      ...(patch.provider !== undefined ? { provider: patch.provider } : {}),
      ...(patch.label !== undefined ? { label: patch.label } : {}),
      ...(patch.baseUrl !== undefined ? { baseUrl: patch.baseUrl } : {}),
      ...(patch.extraModels !== undefined
        ? { extraModels: patch.extraModels }
        : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...secretColumns,
      updatedAt: new Date(),
    })
    .where(eq(modelCredentials.id, id))
    .returning();
  return row ? toModelCredential(row) : null;
}

export async function deleteModelCredential(id: string) {
  // Hard delete, like the registries. Nothing references this table, and a
  // deleted key simply removes its provider's models from the picker.
  const [row] = await getDb()
    .delete(modelCredentials)
    .where(eq(modelCredentials.id, id))
    .returning({ id: modelCredentials.id });
  return row ?? null;
}

/** Record the verdict from a "Test key" run. */
export async function recordModelValidation(
  id: string,
  result: { models: string[]; error: string | null },
): Promise<ModelCredential | null> {
  const [row] = await getDb()
    .update(modelCredentials)
    .set({
      validatedModels: result.models,
      lastValidatedAt: new Date(),
      lastValidationError: result.error,
      updatedAt: new Date(),
    })
    .where(eq(modelCredentials.id, id))
    .returning();
  return row ? toModelCredential(row) : null;
}
