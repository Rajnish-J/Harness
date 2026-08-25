/**
 * Convert between the stored graph document and React Flow's node/edge arrays.
 *
 * React Flow decorates nodes with transient UI fields (selected, dragging,
 * measured, width, height, positionAbsolute). Those must never reach the
 * database: they'd make every save a diff, and the Python schema rejects
 * unknown keys inside node config.
 */

import type { Edge, Node } from "@xyflow/react";

import type { NodeRunState } from "./run-state";
import type {
  AgentNodeConfig,
  Branch,
  ConditionNodeConfig,
  WorkflowEdge,
  WorkflowGraph,
  WorkflowNode,
} from "./workflow-types";

export type HarnessNodeData = {
  label: string;
  nodeType: "agent" | "condition";
  config: AgentNodeConfig | ConditionNodeConfig | Record<string, unknown>;
  /** Live run status, painted on during a run. Never persisted —
   *  fromReactFlow() deliberately does not read it. */
  run?: NodeRunState;
};

export type FlowNode = Node<HarnessNodeData>;

export function toReactFlow(graph: WorkflowGraph): {
  nodes: FlowNode[];
  edges: Edge[];
} {
  const nodes: FlowNode[] = graph.nodes.map((node) => ({
    id: node.id,
    type: node.type === "condition" ? "conditionNode" : "agentNode",
    position: node.position ?? { x: 0, y: 0 },
    data: {
      label: node.label || node.id,
      nodeType: node.type,
      config: node.config ?? {},
    },
  }));

  const edges: Edge[] = graph.edges.map((edge) => ({
    id: edge.id || `${edge.source}->${edge.target}`,
    source: edge.source,
    target: edge.target,
    // The stored `branch` is React Flow's sourceHandle.
    sourceHandle: edge.branch ?? undefined,
    label: edge.branch ?? undefined,
  }));

  return { nodes, edges };
}

export function fromReactFlow(nodes: FlowNode[], edges: Edge[]): WorkflowGraph {
  const outNodes: WorkflowNode[] = nodes.map((node) => ({
    id: node.id,
    type: node.data.nodeType,
    label: node.data.label ?? node.id,
    // Round to whole pixels: sub-pixel drift would make every drag a "change".
    position: {
      x: Math.round(node.position.x),
      y: Math.round(node.position.y),
    },
    config: node.data.config ?? {},
  }));

  const outEdges: WorkflowEdge[] = edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    branch: (edge.sourceHandle as Branch | undefined) ?? null,
  }));

  return { nodes: outNodes, edges: outEdges };
}

let counter = 0;

/** Node ids must satisfy the Python schema: alphanumerics, '-' and '_' only. */
export function newNodeId(type: "agent" | "condition"): string {
  counter += 1;
  const prefix = type === "condition" ? "cond" : "agent";
  return `${prefix}_${Date.now().toString(36)}_${counter}`;
}

export function defaultConfigFor(
  type: "agent" | "condition",
): AgentNodeConfig | ConditionNodeConfig {
  if (type === "condition") {
    return {
      predicate: {
        left: { path: "outputs" },
        op: "is_not_empty",
      },
    } as ConditionNodeConfig;
  }
  return { prompt: "", tools: null, on_error: "fail" };
}
