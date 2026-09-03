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

/**
 * The model wants to create a new blank project; a human must say yes.
 * Emitted instead of ApprovalRequestEvent for a propose_create_project call,
 * in every tool mode — creating a project is a one-way door.
 */
export type ProjectProposalEvent = {
  type: "project_proposal";
  id: string;
  name: string;
  description: string;
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
  usage?: { input_tokens: number; output_tokens: number } | null;
};

export type AgentEvent =
  | ToolCallEvent
  | ToolResultEvent
  | ApprovalRequestEvent
  | ProjectProposalEvent
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
    }
  /**
   * A proposal to create a new blank project, awaiting a human verdict. Unlike
   * an approval, "approved" here means the client already created the project
   * (see ProjectProposalCard) before telling the backend — the card keeps
   * rendering its own outcome rather than folding into a generic step.
   */
  | {
      kind: "project_proposal";
      id: string;
      name: string;
      description: string;
      decision?: "approved" | "denied";
    };

/**
 * `GET /api/config`. The first five fields are the original contract and are
 * always present; HarnessStatus reads them too.
 *
 * Everything below is optional because it is: a harness running an older build
 * of the Python side answers without these groups, and the settings page shows
 * an em-dash rather than crashing. Secrets appear only as "is it configured".
 */
export type HarnessConfig = {
  provider: string;
  model: string;
  max_iterations: number;
  workspace_root: string;
  /** The harness's own MCP mock switch, distinct from NEXT_PUBLIC_MOCK_MCP. */
  mock_mcp: boolean;

  /** Whether each secret is set — never its value. */
  secrets?: {
    llm_api_key: boolean;
    database_url: boolean;
    credentials_encryption_key: boolean;
  };
  limits?: {
    max_file_bytes: number;
    command_timeout_seconds: number;
    max_command_output_bytes: number;
    max_system_prompt_chars: number;
  };
  /** null means the matching tool refuses rather than guessing a framework. */
  commands?: {
    test: string | null;
    lint: string | null;
    build: string | null;
  };
  workflows?: {
    max_nodes: number;
    max_supersteps: number;
    max_node_output_chars: number;
    max_interpolated_chars: number;
  };
  mcp?: {
    attach_all_enabled: boolean;
    connect_timeout: number;
    list_timeout: number;
    tool_timeout: number;
    idle_timeout: number;
    retry_cooldown: number;
  };
  containers?: {
    default_image: string;
    port: number;
  };
  database?: {
    pool_min: number;
    pool_max: number;
  };
  cors_origins?: string[];
};
