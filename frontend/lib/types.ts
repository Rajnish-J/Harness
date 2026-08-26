/**
 * TypeScript mirror of the backend's SSE event union
 * (backend/app/models/events.py). Keep the two in sync.
 */

export type ToolCallEvent = {
  type: "tool_call";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type ToolResultEvent = {
  type: "tool_result";
  id: string;
  name: string;
  is_error: boolean;
  content: string;
};

/** Manual mode: a tool call the harness will not run until the user says so. */
export type ApprovalRequestEvent = {
  type: "approval_request";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type AssistantMessageEvent = {
  type: "assistant_message";
  text: string;
};

export type ErrorEvent = {
  type: "error";
  message: string;
  code: string;
};

export type DoneEvent = {
  type: "done";
  reason:
    | "end_turn"
    | "max_iterations"
    | "error"
    | "disconnected"
    // Terminal for this stream only — the turn resumes via /api/chat/approve.
    | "awaiting_approval";
};

export type AgentEvent =
  | ToolCallEvent
  | ToolResultEvent
  | ApprovalRequestEvent
  | AssistantMessageEvent
  | ErrorEvent
  | DoneEvent;

/**
 * A transcript entry. Tool calls and their results are rendered as visible
 * steps between assistant messages — watching the loop work is the whole point
 * of streaming, so steps are first-class transcript items, not hidden state.
 */
export type TranscriptItem =
  | { kind: "user"; id: string; text: string }
  | { kind: "assistant"; id: string; text: string }
  | { kind: "error"; id: string; message: string; code: string }
  | {
      kind: "step";
      id: string;
      name: string;
      arguments: Record<string, unknown>;
      status: "running" | "ok" | "error";
      result?: string;
    }
  /**
   * A manual-mode tool call awaiting a verdict. It becomes a `step` the moment
   * the resume streams its result back, so the transcript ends up identical to
   * an automatic run — the approval is a stage, not a separate kind of history.
   */
  | {
      kind: "approval";
      id: string;
      name: string;
      arguments: Record<string, unknown>;
      decision?: "approved" | "denied";
    };

export type HarnessConfig = {
  provider: string;
  model: string;
  max_iterations: number;
  workspace_root: string;
};
