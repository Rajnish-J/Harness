/**
 * Client for the two backends.
 *
 * Execution (streaming, cancel, validate, tools) goes straight to the Python
 * harness; CRUD goes to Next.js route handlers backed by Drizzle. That split
 * mirrors who owns which tables — see backend/app/api/workflows.py.
 */

import { API_BASE } from "./api";
import { flags } from "./flags";
import { MOCK_BUILTIN_TOOLS, MOCK_MCP_TOOLS } from "./mock/tools";
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
  /**
   * The section this tool files under, set by the harness: "File Operations"
   * for the built-ins, `MCP · {server}` for MCP-discovered ones. Optional
   * because an older harness predates the field.
   */
  group?: string;
};

export async function fetchTools(signal?: AbortSignal): Promise<ToolInfo[]> {
  // Built-ins only. MCP tools come from fetchMcpTools below, per attached
  // server, because discovering them costs a round trip to each one.
  if (flags.mockTools) return MOCK_BUILTIN_TOOLS;

  try {
    const res = await fetch(`${API_BASE}/api/workflows/tools`, { signal });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

/**
 * Tools discovered from the given MCP servers, plus notices for any that
 * failed to answer.
 *
 * A server being down is data, not an error: the composer shows the notice
 * next to the tools that did resolve, which is why this returns both rather
 * than throwing.
 *
 * `serverNotices` carries the same messages with the server id attached, so the
 * composer can put a failure against the right row instead of matching the
 * server's name inside the prose.
 */
export type McpServerNotice = {
  message: string;
  /** null for notices that name no server — a missing DATABASE_URL, say. */
  server_id: string | null;
  server_name: string | null;
};

export type McpToolsResult = {
  tools: ToolInfo[];
  notices: string[];
  serverNotices: McpServerNotice[];
};

const NO_MCP_TOOLS: McpToolsResult = { tools: [], notices: [], serverNotices: [] };

/**
 * `includeDisabled` reaches servers whose `enabled` flag is off.
 *
 * Only /tools passes it, and only to report what a configured server offers.
 * The composer must not: the harness reads mcp_servers with an enabled filter
 * on every chat path, so a disabled server's tools could be listed here and
 * still never be spendable — showing them in the picker would be a promise the
 * turn cannot keep.
 */
export async function fetchMcpTools(
  serverIds: string[],
  signal?: AbortSignal,
  options?: { includeDisabled?: boolean },
): Promise<McpToolsResult> {
  if (serverIds.length === 0) return NO_MCP_TOOLS;
  if (flags.mockTools || flags.mockMcp) {
    return { tools: MOCK_MCP_TOOLS, notices: [], serverNotices: [] };
  }

  try {
    const query = encodeURIComponent(serverIds.join(","));
    const suffix = options?.includeDisabled ? "&include_disabled=true" : "";
    const res = await fetch(
      `${API_BASE}/api/mcp/tools?server_ids=${query}${suffix}`,
      { signal },
    );
    if (!res.ok) return NO_MCP_TOOLS;
    const payload = (await res.json()) as {
      tools: ToolInfo[];
      notices: string[];
      server_notices?: McpServerNotice[];
    };
    return {
      tools: payload.tools ?? [],
      notices: payload.notices ?? [],
      // Optional so a backend older than this field degrades to the flat list
      // rather than rendering nothing.
      serverNotices: payload.server_notices ?? [],
    };
  } catch {
    return NO_MCP_TOOLS;
  }
}

export type McpTestResult = {
  ok: boolean;
  error: string | null;
  toolCount: number;
};

/**
 * Connect to one MCP server right now, bypassing the failure cooldown.
 *
 * Unlike fetchMcpTools above, failures here are not swallowed: a user pressing
 * "Test connection" wants to see exactly why it failed, not a silent empty
 * result. mockMcp reports a fixed pass — there is no real server to dial.
 */
export async function testMcpServer(serverId: string): Promise<McpTestResult> {
  if (flags.mockMcp) return { ok: true, error: null, toolCount: 0 };

  const res = await fetch(`${API_BASE}/api/mcp/${serverId}/test`, {
    method: "POST",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as { detail?: string }).detail ?? `Request failed: ${res.status}`,
    );
  }

  const data = (await res.json()) as {
    ok: boolean;
    error: string | null;
    tool_count: number;
  };
  return { ok: data.ok, error: data.error, toolCount: data.tool_count };
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

export async function createWorkflow(
  name: string,
  graph?: WorkflowGraph,
): Promise<Workflow> {
  return json(
    await fetch("/api/workflows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, ...(graph ? { graph } : {}) }),
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
