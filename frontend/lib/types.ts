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
  reason: "end_turn" | "max_iterations" | "error" | "disconnected";
};

export type AgentEvent =
  | ToolCallEvent
  | ToolResultEvent
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
    };

export type HarnessConfig = {
  provider: string;
  model: string;
  max_iterations: number;
  workspace_root: string;
};
