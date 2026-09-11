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
  /** The scaffold the model suggested; "" when it picked none. Optional so an
   *  older backend that does not send it still typechecks. */
  template?: string;
};

/**
 * The model wants to file this conversation under a project that already
 * exists. The sibling of ProjectProposalEvent, which creates a new one.
 */
export type AttachProposalEvent = {
  type: "attach_proposal";
  id: string;
  project_id: string;
  /** Resolved server-side, so the card never shows a bare uuid. */
  project_name: string;
  reason?: string;
};

/**
 * Which tools the harness narrowed this turn to, and why.
 *
 * Sent once, before the first step, whenever narrowing was possible — including
 * when it did not happen. `ran: false` with a `note` is a router that failed
 * open, and must render as such: a silent fallback looks identical to a router
 * that simply chose everything.
 */
export type ToolSelectionEvent = {
  type: "tool_selection";
  id: string;
  /** Group travels with the name so the UI need not re-fetch the catalog. */
  selected: { name: string; group: string }[];
  pool_size: number;
  reason?: string;
  ran?: boolean;
  note?: string | null;
  model?: string | null;
};

/**
 * The turn needs an MCP server this chat is not allowed to use yet.
 *
 * Registering a server on /mcp does not attach it to a chat, so a request that
 * needed one used to reach a model that had never heard of it — which then
 * apologised for a capability the user had already set up. The router sees
 * every enabled server now and asks before the turn runs.
 *
 * Terminal for its stream: nothing ran, and nothing was written. Approving
 * re-sends the same message with the server attached.
 */
export type McpConsentEvent = {
  type: "mcp_consent";
  id: string;
  servers: { id: string; name: string }[];
  reason?: string;
  /** Nothing registered can serve this — the card offers the catalog instead. */
  missing?: boolean;
};

export type AssistantMessageEvent = {
  type: "assistant_message";
  text: string;
  /**
   * The harness's stable id for this message.
   *
   * Minted by the agent loop and persisted with the message, so the id a
   * live message has is the id it still has after a reload -- which is
   * what lets a thumb stay attached to the reply it was about. The
   * transcript's own item ids cannot do this: they are a render-time
   * counter live and `h-<seq>` when rehydrated.
   *
   * Optional only for the mock and for an older harness that does not
   * send it; a message without one simply shows no feedback controls.
   */
  message_uid?: string;
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
  | ToolSelectionEvent
  | McpConsentEvent
  | ApprovalRequestEvent
  | ProjectProposalEvent
  | AttachProposalEvent
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
  | {
      kind: "assistant";
      id: string;
      text: string;
      /** Stable across a reload, unlike `id`. Feedback keys on it. */
      messageUid?: string;
    }
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
      template?: string;
      decision?: "approved" | "denied";
    }
  /**
   * The tool router's decision for this turn, rendered as a vertical stepper
   * above the steps it governs. Not a `step`: it has no call, no result and no
   * running state, and folding it into one would make it expand into a `pre`
   * block of JSON rather than a list of tools.
   */
  | {
      kind: "tool_selection";
      id: string;
      selected: { name: string; group: string }[];
      poolSize: number;
      reason: string;
      ran: boolean;
      note?: string | null;
      model?: string | null;
    }
  /**
   * A request to use an MCP server the user registered but has not attached
   * here. Unlike an approval this parks before the turn starts, so declining
   * simply drops the message — there is no half-turn to clean up.
   */
  | {
      kind: "mcp_consent";
      id: string;
      servers: { id: string; name: string }[];
      reason: string;
      missing: boolean;
      /** The message to re-send on approval, so the turn can actually resume. */
      message: string;
      decision?: "approved" | "declined";
    }
  /**
   * What a finished turn cost, rendered as a collapsed row at its end.
   *
   * Derived, never stored: the backend records a turn's token totals on the
   * assistant message that ended it, and both the live reducer and
   * `toTranscript` build this from the rows around it. Storing it as a row of
   * its own would mean a new value in the `chat_role` enum -- and a migration
   * -- for something every reader can already work out.
   */
  | {
      kind: "turn_summary";
      id: string;
      /** Tool calls in this turn. `steps` and `toolCalls` are the same number
       *  today: every step IS a tool call. Both are rendered because the two
       *  read differently, not because they can diverge. */
      steps: number;
      toolCalls: number;
      inputTokens: number;
      outputTokens: number;
    }
  /** An offer to move this conversation into an existing project. */
  | {
      kind: "attach_proposal";
      id: string;
      projectId: string;
      projectName: string;
      reason?: string;
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
