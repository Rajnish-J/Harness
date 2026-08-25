/**
 * TypeScript mirror of backend/app/workflow/schema.py.
 *
 * The Python side is the arbiter — anything sent from here is re-validated by
 * POST /api/workflows/validate before it can run. These types exist for editor
 * ergonomics and for typing the JSONB column, not as a security boundary.
 */

export type NodeType = "agent" | "condition";
export type OnError = "fail" | "continue";
export type Branch = "true" | "false";

export type AgentNodeConfig = {
  prompt: string;
  /** null or [] means every registered tool. */
  tools?: string[] | null;
  max_iterations?: number | null;
  on_error?: OnError;
  /** Reserved for per-node model selection; unused in this milestone. */
  model?: string | null;
};

/** Operand tagging is what keeps the predicate DSL injection-proof: a value is
 *  never ambiguously "maybe a path". */
export type Operand = { path: string } | { value: unknown };

export type ComparisonOp =
  | "eq" | "ne" | "lt" | "lte" | "gt" | "gte"
  | "contains" | "not_contains" | "starts_with" | "ends_with"
  | "in" | "not_in";

export type UnaryOp = "is_empty" | "is_not_empty" | "is_true" | "is_false";

export type Predicate =
  | { left: Operand; op: ComparisonOp; right: Operand; case_insensitive?: boolean }
  | { left: Operand; op: UnaryOp }
  | { all: Predicate[] }
  | { any: Predicate[] }
  | { not: Predicate };

export type ConditionNodeConfig = {
  predicate: Predicate | Record<string, never>;
};

export type WorkflowNode = {
  id: string;
  type: NodeType;
  label: string;
  position: { x: number; y: number };
  config: AgentNodeConfig | ConditionNodeConfig | Record<string, unknown>;
};

export type WorkflowEdge = {
  id: string;
  source: string;
  target: string;
  /** React Flow's sourceHandle for condition nodes; null on plain edges. */
  branch: Branch | null;
};

export type WorkflowGraph = {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
};

export type ValidationIssue = {
  code: string;
  severity: "error" | "warning";
  message: string;
  node_id: string | null;
  edge_id: string | null;
};

export type WorkflowSummary = {
  id: string;
  name: string;
  description: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type Workflow = WorkflowSummary & { graph: WorkflowGraph };

export const EMPTY_GRAPH: WorkflowGraph = { nodes: [], edges: [] };

export const TOOL_LABELS: Record<string, string> = {
  read_file: "read",
  write_file: "write",
  list_directory: "list",
};
