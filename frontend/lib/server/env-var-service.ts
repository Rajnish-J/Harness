/**
 * Drizzle access for project environment variables.
 *
 * Modelled on credential-service.ts, and for the same reason: every read goes
 * through `toEnvVar()`, which builds the DTO field by field. There is no branch
 * that can emit `valueCiphertext`, and the ONE branch that can emit a plaintext
 * value is guarded by `row.secret` — so "a secret leaked into a list response"
 * is not a mistake a future caller can make by spreading a row.
 *
 * Encryption happens here, not in the route handlers, so there is exactly one
 * place a plaintext value becomes a stored one.
 */

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { projectEnvVars, projects, type ProjectEnvVarRow } from "@/db/schema";
import type {
  EnvVarInput,
  EnvVarListRow,
  ProjectEnvVar,
} from "@/lib/env-var-types";
import { decryptSecret, encryptValue, lastFourOf } from "@/lib/server/crypto";

/**
 * The row -> DTO boundary.
 *
 * A non-secret value is decrypted here rather than stored in plaintext, so the
 * database looks the same either way and flipping `secret` on an existing row
 * never has to re-encrypt anything.
 */
function toEnvVar(row: ProjectEnvVarRow): ProjectEnvVar {
  return {
    id: row.id,
    projectId: row.projectId,
    key: row.key,
    secret: row.secret,
    value: row.secret ? null : safeDecrypt(row.valueCiphertext),
    lastFour: row.lastFour,
    description: row.description,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * A value encrypted under a key that has since changed should not take out the
 * whole page. The row still lists, with its value shown as unreadable — which
 * is the truth, and points at the actual fix.
 */
function safeDecrypt(blob: string): string | null {
  try {
    return decryptSecret(blob);
  } catch {
    return null;
  }
}

/** Every variable, newest project activity first, with its project attached. */
export async function listEnvVars(): Promise<EnvVarListRow[]> {
  const rows = await getDb()
    .select({ envVar: projectEnvVars, name: projects.name, slug: projects.slug })
    .from(projectEnvVars)
    .innerJoin(projects, eq(projectEnvVars.projectId, projects.id))
    .orderBy(asc(projects.name), asc(projectEnvVars.key));

  return rows.map((row) => ({
    ...toEnvVar(row.envVar),
    projectName: row.name,
    projectSlug: row.slug,
  }));
}

export async function listEnvVarsForProject(
  projectId: string,
): Promise<ProjectEnvVar[]> {
  const rows = await getDb()
    .select()
    .from(projectEnvVars)
    .where(eq(projectEnvVars.projectId, projectId))
    .orderBy(asc(projectEnvVars.key));
  return rows.map(toEnvVar);
}

export async function getEnvVar(id: string): Promise<ProjectEnvVar | null> {
  const [row] = await getDb()
    .select()
    .from(projectEnvVars)
    .where(eq(projectEnvVars.id, id))
    .limit(1);
  return row ? toEnvVar(row) : null;
}

export async function createEnvVar(input: EnvVarInput): Promise<ProjectEnvVar> {
  const [row] = await getDb()
    .insert(projectEnvVars)
    .values({
      projectId: input.projectId,
      key: input.key,
      valueCiphertext: encryptValue(input.value),
      lastFour: lastFourOf(input.value),
      secret: input.secret ?? true,
      description: input.description ?? null,
    })
    .returning();
  return toEnvVar(row!);
}

export async function updateEnvVar(
  id: string,
  patch: Partial<EnvVarInput>,
): Promise<ProjectEnvVar | null> {
  // Unlike a credential's token, a value CAN be edited in place — the editor is
  // allowed to show a non-secret one, so "" is a legitimate new value (an empty
  // string is a thing a `.env` can hold). Absent still means "leave it alone".
  const valueColumns =
    patch.value !== undefined
      ? {
          valueCiphertext: encryptValue(patch.value),
          lastFour: lastFourOf(patch.value),
        }
      : {};

  const [row] = await getDb()
    .update(projectEnvVars)
    .set({
      ...(patch.key !== undefined ? { key: patch.key } : {}),
      ...(patch.secret !== undefined ? { secret: patch.secret } : {}),
      ...(patch.description !== undefined
        ? { description: patch.description }
        : {}),
      ...valueColumns,
      updatedAt: new Date(),
    })
    .where(eq(projectEnvVars.id, id))
    .returning();
  return row ? toEnvVar(row) : null;
}

export async function deleteEnvVar(id: string) {
  const [row] = await getDb()
    .delete(projectEnvVars)
    .where(eq(projectEnvVars.id, id))
    .returning({ id: projectEnvVars.id });
  return row ?? null;
}

/**
 * Bulk upsert from pasted `.env` text.
 *
 * Upsert rather than insert, because the whole point of pasting a `.env` is
 * that it is the file you already have: half its keys usually exist, and
 * failing the paste on the first 23505 would make the feature useless. Postgres
 * settles it in one statement against the `(project_id, key)` unique index, so
 * there is no read-then-write race between two operators pasting at once.
 *
 * `secret` is per-import, not per-key: the pasted text carries no marker for
 * which values are sensitive, and guessing from the key name would be wrong in
 * exactly the cases that matter.
 */
export async function importEnvVars(
  projectId: string,
  entries: { key: string; value: string }[],
  options: { secret: boolean },
): Promise<ProjectEnvVar[]> {
  if (entries.length === 0) return [];

  const rows = await getDb()
    .insert(projectEnvVars)
    .values(
      entries.map((entry) => ({
        projectId,
        key: entry.key,
        valueCiphertext: encryptValue(entry.value),
        lastFour: lastFourOf(entry.value),
        secret: options.secret,
      })),
    )
    .onConflictDoUpdate({
      target: [projectEnvVars.projectId, projectEnvVars.key],
      // `excluded` is the row Postgres was about to insert — the pasted value
      // wins over the stored one, which is what "import this .env" means.
      set: {
        valueCiphertext: sql`excluded."value_ciphertext"`,
        lastFour: sql`excluded."last_four"`,
        secret: sql`excluded."secret"`,
        updatedAt: new Date(),
      },
    })
    .returning();

  return rows.map(toEnvVar);
}

export async function deleteEnvVars(ids: string[]) {
  if (ids.length === 0) return [];
  return getDb()
    .delete(projectEnvVars)
    .where(inArray(projectEnvVars.id, ids))
    .returning({ id: projectEnvVars.id });
}

/**
 * Guard for the routes: is this a live project?
 *
 * Archived counts as gone. A project delete is soft (see db/schema.ts), so
 * without the `archived_at` check an operator could keep adding variables to a
 * project that has already vanished from every list in the app.
 */
export async function isLiveProject(projectId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), isNull(projects.archivedAt)))
    .limit(1);
  return Boolean(row);
}
