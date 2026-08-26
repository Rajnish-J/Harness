import { desc, eq, isNull, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { workflows } from "@/db/schema";
import { flags } from "@/lib/flags";
import { MOCK_WORKFLOWS } from "@/lib/mock/workflows";
import {
  EMPTY_GRAPH,
  type ValidationIssue,
  type Workflow,
  type WorkflowGraph,
} from "@/lib/workflow-types";

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
  // Python owns the real schema, and mock mode cannot reach it. Accepting the
  // graph here is the honest choice: refusing every write would make the mock
  // editor unusable, and there is no second opinion available to consult.
  if (flags.mockWorkflow) return { ok: true, issues: [] };

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
  if (flags.mockWorkflow) {
    return mockWorkflowStore()
      .map((workflow) => ({
        id: workflow.id,
        name: workflow.name,
        description: workflow.description,
        version: workflow.version,
        createdAt: new Date(workflow.createdAt),
        updatedAt: new Date(workflow.updatedAt),
      }))
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  return getDb()
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
  if (flags.mockWorkflow) {
    const found = mockWorkflowStore().find((workflow) => workflow.id === id);
    return found
      ? {
          ...found,
          graph: found.graph,
          graphVersion: 1,
          archivedAt: null as Date | null,
          createdAt: new Date(found.createdAt),
          updatedAt: new Date(found.updatedAt),
        }
      : null;
  }

  const [row] = await getDb().select().from(workflows).where(eq(workflows.id, id)).limit(1);
  return row ?? null;
}

export async function createWorkflow(input: {
  name: string;
  description?: string | null;
  graph?: WorkflowGraph;
}) {
  const graph = input.graph ?? EMPTY_GRAPH;

  if (flags.mockWorkflow) {
    const now = new Date();
    const created = {
      id: mockWorkflowId(),
      name: input.name,
      description: input.description ?? null,
      graph,
      version: 1,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    mockWorkflowStore().unshift(created);
    return {
      ...created,
      graphVersion: 1,
      archivedAt: null as Date | null,
      createdAt: now,
      updatedAt: now,
    };
  }

  const [row] = await getDb()
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
  if (flags.mockWorkflow) {
    const store = mockWorkflowStore();
    const found = store.find((workflow) => workflow.id === id);
    if (!found) return null;
    if (patch.name !== undefined) found.name = patch.name;
    if (patch.description !== undefined) found.description = patch.description;
    if (patch.graph !== undefined) found.graph = patch.graph;
    found.version += 1;
    found.updatedAt = new Date().toISOString();
    return {
      ...found,
      graphVersion: 1,
      archivedAt: null as Date | null,
      createdAt: new Date(found.createdAt),
      updatedAt: new Date(found.updatedAt),
    };
  }

  const [row] = await getDb()
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
  if (flags.mockWorkflow) {
    const store = mockWorkflowStore();
    const index = store.findIndex((workflow) => workflow.id === id);
    if (index === -1) return null;
    store.splice(index, 1);
    return { id };
  }

  const [row] = await getDb()
    .update(workflows)
    .set({ archivedAt: new Date() })
    .where(eq(workflows.id, id))
    .returning({ id: workflows.id });
  return row ?? null;
}

/**
 * Mutable workflow fixtures, cached on globalThis so Next's dev HMR does not
 * discard whatever you just created. Same reasoning as db/index.ts's pool cache
 * and lib/mock/store.ts.
 */
const globalForMockWorkflows = globalThis as unknown as {
  __harnessMockWorkflows?: (Workflow & { graph: WorkflowGraph })[];
};

function mockWorkflowStore() {
  if (!globalForMockWorkflows.__harnessMockWorkflows) {
    globalForMockWorkflows.__harnessMockWorkflows = MOCK_WORKFLOWS.map((w) => ({
      ...w,
    }));
  }
  return globalForMockWorkflows.__harnessMockWorkflows;
}

/** Minted in a create call — an event path, never a render. */
function mockWorkflowId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `mock-wf-${Date.now()}`;
}
