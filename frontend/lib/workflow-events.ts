/** TypeScript mirror of backend/app/models/workflow_events.py. */

import type { AgentEvent } from "./types";
import type { ValidationIssue } from "./workflow-types";

export type NodeStatus = "ok" | "error" | "skipped" | "cancelled";

export type WorkflowStartedEvent = {
  type: "workflow_started";
  run_id: string;
  workflow_id: string;
  node_ids: string[];
};

export type NodeStartedEvent = {
  type: "node_started";
  node_id: string;
  node_type: string;
  label: string;
  attempt: number;
};

/** Envelope carrying one inner agent event, tagged with its node. */
export type NodeEventEnvelope = {
  type: "node_event";
  node_id: string;
  event: AgentEvent;
};

export type NodeFinishedEvent = {
  type: "node_finished";
  node_id: string;
  status: NodeStatus;
  output_preview: string;
  error: string | null;
  duration_ms: number;
  input_tokens: number | null;
  output_tokens: number | null;
};

export type EdgeTakenEvent = {
  type: "edge_taken";
  source: string;
  target: string;
  branch: string | null;
};

export type WorkflowErrorEvent = {
  type: "workflow_error";
  message: string;
  code: string;
  node_id: string | null;
  issues: ValidationIssue[];
};

export type WorkflowDoneEvent = {
  type: "workflow_done";
  run_id: string;
  reason:
    | "completed"
    | "error"
    | "cancelled"
    | "recursion_limit"
    | "disconnected"
    | "invalid";
  node_count: number;
  duration_ms: number;
};

export type WorkflowEvent =
  | WorkflowStartedEvent
  | NodeStartedEvent
  | NodeEventEnvelope
  | NodeFinishedEvent
  | EdgeTakenEvent
  | WorkflowErrorEvent
  | WorkflowDoneEvent
  // The chat-level `done` also arrives on some early-exit paths.
  | { type: "done"; reason: string };
