import { desc, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { workflows } from "@/db/schema";
import { EMPTY_GRAPH, type ValidationIssue, type WorkflowGraph } from "@/lib/workflow-types";

const PYTHON_API =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

export type ValidationResult = { ok: boolean; issues: ValidationIssue[] };

/**
 * Validate a graph via the Python harness before writing it.
 *
 * Python owns the graph schema — the TypeScript types are for editor
 * ergonomics, not a security boundary. Every write goes through here so a graph
 * that cannot execute never reaches the database.
 *
 * If the harness is unreachable we refuse the write rather than storing
 * something unvalidated.
 */
export async function validateGraph(graph: WorkflowGraph): Promise<ValidationResult> {
  const res = await fetch(`${PYTHON_API}/api/workflows/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ graph }),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Harness validation failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as ValidationResult;
}

export async function listWorkflows() {
  return db
    .select({
      id: workflows.id,
      name: workflows.name,
      description: workflows.description,
      version: workflows.version,
      createdAt: workflows.createdAt,
      updatedAt: workflows.updatedAt,
    })
    .from(workflows)
    .where(isNull(workflows.archivedAt))
    .orderBy(desc(workflows.updatedAt));
}

export async function getWorkflow(id: string) {
  const [row] = await db.select().from(workflows).where(eq(workflows.id, id)).limit(1);
  return row ?? null;
}

export async function createWorkflow(input: {
  name: string;
  description?: string | null;
  graph?: WorkflowGraph;
}) {
  const graph = input.graph ?? EMPTY_GRAPH;
  const [row] = await db
    .insert(workflows)
    .values({
      name: input.name,
      description: input.description ?? null,
      graph,
    })
    .returning();
  return row;
}

export async function updateWorkflow(
  id: string,
  patch: { name?: string; description?: string | null; graph?: WorkflowGraph },
) {
  const [row] = await db
    .update(workflows)
    .set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.graph !== undefined ? { graph: patch.graph } : {}),
      // Bump on every save so a run can record which revision it executed.
      // Done in SQL rather than read-modify-write so concurrent saves can't
      // both read the same version and write the same bump.
      version: sql`${workflows.version} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(workflows.id, id))
    .returning();
  return row ?? null;
}

/**
 * Soft delete. Run history has a restrict FK onto workflows, so a hard delete
 * would either fail or (with cascade) silently erase the audit trail.
 */
export async function archiveWorkflow(id: string) {
  const [row] = await db
    .update(workflows)
    .set({ archivedAt: new Date() })
    .where(eq(workflows.id, id))
    .returning({ id: workflows.id });
  return row ?? null;
}
