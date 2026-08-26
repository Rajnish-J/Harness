/**
 * Client for the two backends.
 *
 * Execution (streaming, cancel, validate, tools) goes straight to the Python
 * harness; CRUD goes to Next.js route handlers backed by Drizzle. That split
 * mirrors who owns which tables — see backend/app/api/workflows.py.
 */

import { API_BASE } from "./api";
import { flags } from "./flags";
import { MOCK_TOOLS } from "./mock/tools";
import { mockRunEvents } from "./mock/workflows";
import { consumeSSE } from "./sse";
import type { WorkflowEvent } from "./workflow-events";
import type {
  ValidationIssue,
  Workflow,
  WorkflowGraph,
  WorkflowSummary,
} from "./workflow-types";

// ---------------------------------------------------------------- execution

export async function streamWorkflowRun(
  params: { workflowId: string; input: string; signal?: AbortSignal },
  onEvent: (event: WorkflowEvent) => void,
): Promise<void> {
  if (flags.mockWorkflow) {
    for (const event of mockRunEvents(params.workflowId)) {
      if (params.signal?.aborted) return;
      await new Promise((resolve) => setTimeout(resolve, 350));
      onEvent(event);
    }
    return;
  }

  const res = await fetch(
    `${API_BASE}/api/workflows/${params.workflowId}/runs`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: params.input }),
      signal: params.signal,
    },
  );
  await consumeSSE<WorkflowEvent>(res, onEvent);
}

export async function cancelRun(runId: string): Promise<boolean> {
  if (flags.mockWorkflow) return true;

  try {
    const res = await fetch(`${API_BASE}/api/runs/${runId}/cancel`, {
      method: "POST",
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { cancelled: boolean };
    return body.cancelled;
  } catch {
    return false;
  }
}

export async function validateGraph(
  graph: WorkflowGraph,
): Promise<{ ok: boolean; issues: ValidationIssue[] }> {
  // Python owns the real graph schema. Mock mode cannot reach it, so it applies
  // the one rule the fixtures exercise: a node nothing points at is unreachable.
  if (flags.mockWorkflow) {
    const targets = new Set(graph.edges.map((edge) => edge.target));
    const issues: ValidationIssue[] = graph.nodes
      .slice(1)
      .filter((node) => !targets.has(node.id))
      .map((node) => ({
        code: "unreachable_node",
        severity: "error" as const,
        message: `Node "${node.label}" is not reachable from the entry node.`,
        node_id: node.id,
        edge_id: null,
      }));
    return { ok: issues.length === 0, issues };
  }

  const res = await fetch(`${API_BASE}/api/workflows/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ graph }),
  });
  if (!res.ok) throw new Error(`Validation request failed: ${res.status}`);
  return res.json();
}

export type ToolInfo = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

export async function fetchTools(signal?: AbortSignal): Promise<ToolInfo[]> {
  if (flags.mockTools) return MOCK_TOOLS;

  try {
    const res = await fetch(`${API_BASE}/api/workflows/tools`, { signal });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

// --------------------------------------------------------------------- CRUD

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as { error?: string }).error ?? `Request failed: ${res.status}`,
    );
  }
  return res.json() as Promise<T>;
}

export async function listWorkflows(): Promise<WorkflowSummary[]> {
  return json(await fetch("/api/workflows", { cache: "no-store" }));
}

export async function createWorkflow(name: string): Promise<Workflow> {
  return json(
    await fetch("/api/workflows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }),
  );
}

export async function saveWorkflow(
  id: string,
  patch: { name?: string; graph?: WorkflowGraph },
): Promise<Workflow> {
  return json(
    await fetch(`/api/workflows/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }),
  );
}

export async function deleteWorkflow(id: string): Promise<void> {
  await fetch(`/api/workflows/${id}`, { method: "DELETE" });
}
