/**
 * Drizzle access for projects.
 *
 * Same shape as registry-service.ts. Two differences worth knowing:
 *
 * - Deletes are SOFT. `project_files` cascades from `projects`, and a container
 *   may be running against the checkout, so a hard delete would drop a tree and
 *   orphan a container to save nothing. `archivedAt` hides the row instead, and
 *   every read here filters on it.
 * - `cloneStatus` and friends are written by Python, not here. This module never
 *   sets them: it would be a second writer for columns whose truth lives in
 *   whether a `git clone` actually succeeded.
 */

import { and, count, desc, eq, isNull } from "drizzle-orm";

import { getDb } from "@/db";
import { projectFiles, projects, type ProjectRow } from "@/db/schema";
import type { Project, ProjectInput } from "@/lib/project-types";

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    provider: row.provider,
    repoOwner: row.repoOwner,
    repoName: row.repoName,
    repoUrl: row.repoUrl,
    repoId: row.repoId,
    defaultBranch: row.defaultBranch,
    visibility: row.visibility,
    credentialId: row.credentialId,
    cloneStatus: row.cloneStatus,
    cloneError: row.cloneError,
    currentBranch: row.currentBranch,
    lastPulledAt: row.lastPulledAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listProjects(): Promise<Project[]> {
  const rows = await getDb()
    .select()
    .from(projects)
    .where(isNull(projects.archivedAt))
    .orderBy(desc(projects.updatedAt));
  return rows.map(toProject);
}

export async function getProject(id: string): Promise<Project | null> {
  const [row] = await getDb()
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), isNull(projects.archivedAt)))
    .limit(1);
  return row ? toProject(row) : null;
}

export async function createProject(input: ProjectInput & { slug: string }) {
  const [row] = await getDb()
    .insert(projects)
    .values({
      name: input.name,
      slug: input.slug,
      provider: input.provider ?? "github",
      repoOwner: input.repoOwner,
      repoName: input.repoName,
      repoUrl: input.repoUrl,
      repoId: input.repoId ?? null,
      defaultBranch: input.defaultBranch ?? "main",
      visibility: input.visibility ?? "private",
      credentialId: input.credentialId ?? null,
      // Always starts pending: the row exists before the clone runs, so the UI
      // has something to attach progress to.
      cloneStatus: "pending",
    })
    .returning();
  return toProject(row!);
}

export async function updateProject(
  id: string,
  patch: Partial<Pick<ProjectInput, "name" | "credentialId" | "defaultBranch">>,
): Promise<Project | null> {
  const [row] = await getDb()
    .update(projects)
    .set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.credentialId !== undefined ? { credentialId: patch.credentialId } : {}),
      ...(patch.defaultBranch !== undefined
        ? { defaultBranch: patch.defaultBranch }
        : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(projects.id, id), isNull(projects.archivedAt)))
    .returning();
  return row ? toProject(row) : null;
}

/** Soft delete. The checkout on disk is cleaned up separately, by Python. */
export async function archiveProject(id: string) {
  const [row] = await getDb()
    .update(projects)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(projects.id, id), isNull(projects.archivedAt)))
    .returning({ id: projects.id });
  return row ?? null;
}

/**
 * Indexed file counts for every project, as one grouped query.
 *
 * Per-project counts would be N+1 against the list page, and counting in JS
 * would mean shipping 5,000 rows to learn one number — the exact thing the
 * index exists to avoid.
 */
export async function fileCountsByProject(): Promise<Map<string, number>> {
  const rows = await getDb()
    .select({ projectId: projectFiles.projectId, count: count() })
    .from(projectFiles)
    .groupBy(projectFiles.projectId);
  return new Map(rows.map((row) => [row.projectId, Number(row.count)]));
}
