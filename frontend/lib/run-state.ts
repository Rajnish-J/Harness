/**
 * Pure reducer: workflow events -> run state.
 *
 * PERFORMANCE CONTRACT: this must return the SAME NodeRunState object for any
 * node an event did not touch. WorkflowEditor syncs run state into React Flow
 * by identity, so a fresh object for every node on every event re-renders the
 * whole canvas — a node emitting a tool_result each second then drags at
 * single-digit fps. Every branch below copies exactly one node's entry.
 *
 * Related: heavyweight transcripts live in `events` here and are read only by
 * RunPanel. They must never reach `node.data`, where they'd be diffed on every
 * frame — a single tool_result can be ~4KB.
 */

import type { AgentEvent } from "./types";
import type { WorkflowEvent } from "./workflow-events";
import type { ValidationIssue } from "./workflow-types";

export type NodeRunState = {
  status: "idle" | "running" | "ok" | "error" | "skipped" | "cancelled";
  startedAt?: number;
  finishedAt?: number;
  currentTool?: string;
  toolCalls: number;
  events: AgentEvent[];
  outputPreview?: string;
  error?: string;
  attempt: number;
};

export type RunState = {
  runId?: string;
  status: "idle" | "running" | "done" | "error" | "cancelled";
  nodes: Record<string, NodeRunState>;
  takenEdges: string[];
  issues: ValidationIssue[];
  error?: string;
  doneReason?: string;
};

export const IDLE_RUN: RunState = {
  status: "idle",
  nodes: {},
  takenEdges: [],
  issues: [],
};

export const edgeKey = (source: string, target: string, branch?: string | null) =>
  `${source}->${target}${branch ? `:${branch}` : ""}`;

function emptyNode(attempt = 1): NodeRunState {
  return { status: "running", toolCalls: 0, events: [], attempt, startedAt: Date.now() };
}

export function applyWorkflowEvent(prev: RunState, event: WorkflowEvent): RunState {
  switch (event.type) {
    case "workflow_started":
      return {
        ...prev,
        runId: event.run_id,
        status: "running",
        // Reset per-node state, but keep the object shape stable.
        nodes: {},
        takenEdges: [],
        issues: [],
        error: undefined,
        doneReason: undefined,
      };

    case "node_started":
      return {
        ...prev,
        nodes: { ...prev.nodes, [event.node_id]: emptyNode(event.attempt) },
      };

    case "node_event": {
      const current = prev.nodes[event.node_id] ?? emptyNode();
      const inner = event.event;
      const next: NodeRunState = {
        ...current,
        events: [...current.events, inner],
      };

      if (inner.type === "tool_call") {
        next.currentTool = inner.name;
        next.toolCalls = current.toolCalls + 1;
      } else if (inner.type === "tool_result") {
        next.currentTool = undefined;
      } else if (inner.type === "error") {
        next.error = inner.message;
      }

      return { ...prev, nodes: { ...prev.nodes, [event.node_id]: next } };
    }

    case "node_finished": {
      const current = prev.nodes[event.node_id] ?? emptyNode();
      return {
        ...prev,
        nodes: {
          ...prev.nodes,
          [event.node_id]: {
            ...current,
            status: event.status,
            currentTool: undefined,
            outputPreview: event.output_preview,
            error: event.error ?? current.error,
            finishedAt: Date.now(),
          },
        },
      };
    }

    case "edge_taken": {
      const key = edgeKey(event.source, event.target, event.branch);
      if (prev.takenEdges.includes(key)) return prev;
      return { ...prev, takenEdges: [...prev.takenEdges, key] };
    }

    case "workflow_error":
      return {
        ...prev,
        error: event.message,
        issues: event.issues ?? [],
        status: "error",
      };

    case "workflow_done":
      return {
        ...prev,
        status:
          event.reason === "completed"
            ? "done"
            : event.reason === "cancelled"
              ? "cancelled"
              : "error",
        doneReason: event.reason,
      };

    default:
      return prev;
  }
}

/** Summary line for the run panel header. */
export function describeRun(state: RunState): string {
  if (state.status === "idle") return "Not run yet";
  if (state.status === "running") {
    const running = Object.entries(state.nodes)
      .filter(([, n]) => n.status === "running")
      .map(([id]) => id);
    return running.length ? `Running: ${running.join(", ")}` : "Running…";
  }
  const done = Object.values(state.nodes).filter((n) => n.status === "ok").length;
  const failed = Object.values(state.nodes).filter((n) => n.status === "error").length;
  const parts = [`${done} ok`];
  if (failed) parts.push(`${failed} failed`);
  if (state.doneReason && state.doneReason !== "completed") {
    parts.push(state.doneReason.replace(/_/g, " "));
  }
  return parts.join(" · ");
}
