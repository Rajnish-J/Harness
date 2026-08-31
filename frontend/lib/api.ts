import { presetToBody, type ChatPreset } from "./chat-preset";
import { flags } from "./flags";
import { streamMockApproval, streamMockChat } from "./mock/chat";
import { consumeSSE } from "./sse";
import type { StoredMessage } from "./project-types";
import type { AgentEvent, HarnessConfig } from "./types";

/** One row in the sidebar's conversation-history list. */
export type ChatSessionSummary = {
  session_id: string;
  updated_at: string;
  message_count: number;
  title: string;
};

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

/** POST a message and consume the agent's SSE event stream. */
export async function streamChat(
  params: {
    sessionId: string;
    message: string;
    preset?: ChatPreset;
    /** Scopes the turn to a project: its workspace, its container, its history. */
    projectId?: string;
    signal?: AbortSignal;
  },
  onEvent: (event: AgentEvent) => void,
): Promise<void> {
  if (flags.mockChat) {
    return streamMockChat(
      {
        ...params,
        preset: params.preset && {
          agentName: params.preset.agent?.name,
          skillNames: params.preset.skills.map((skill) => skill.name),
          toolNames: params.preset.toolNames ?? [],
          mode: params.preset.mode,
        },
      },
      onEvent,
    );
  }

  const res = await fetch(`${API_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // presetToBody omits every empty field, so a chat with nothing attached
    // posts exactly the two-field body it posted before presets existed.
    body: JSON.stringify(
      presetToBody(params.preset, {
        session_id: params.sessionId,
        message: params.message,
        // Omitted entirely when absent, so a plain chat posts the same body it
        // posted before projects existed.
        ...(params.projectId ? { project_id: params.projectId } : {}),
      }),
    ),
    signal: params.signal,
  });

  await consumeSSE<AgentEvent>(res, onEvent);
}

/**
 * Resolve a manual-mode turn that is parked awaiting approval.
 *
 * Streams like /api/chat because it *is* the rest of the same turn: the same
 * event types arrive, and the caller folds them into the same transcript. The
 * preset rides along so the backend rebuilds an identical turn context — the
 * toolset that was approved is the toolset that runs.
 */
export async function streamApproval(
  params: {
    sessionId: string;
    decisions: { id: string; approved: boolean }[];
    preset?: ChatPreset;
    projectId?: string;
    signal?: AbortSignal;
  },
  onEvent: (event: AgentEvent) => void,
): Promise<void> {
  if (flags.mockChat) {
    return streamMockApproval(
      { sessionId: params.sessionId, decisions: params.decisions, signal: params.signal },
      onEvent,
    );
  }

  const res = await fetch(`${API_BASE}/api/chat/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      presetToBody(params.preset, {
        session_id: params.sessionId,
        decisions: params.decisions,
        ...(params.projectId ? { project_id: params.projectId } : {}),
      }),
    ),
    signal: params.signal,
  });

  await consumeSSE<AgentEvent>(res, onEvent);
}

export async function fetchConfig(
  signal?: AbortSignal,
): Promise<HarnessConfig | null> {
  // A plausible line rather than "harness core offline", so mock mode does not
  // look like a broken deployment.
  if (flags.mockChat) {
    return {
      provider: "anthropic",
      model: "claude-opus-5",
      max_iterations: 8,
      workspace_root: "./workspace (mock)",
    };
  }

  try {
    const res = await fetch(`${API_BASE}/api/config`, { signal });
    if (!res.ok) return null;
    return (await res.json()) as HarnessConfig;
  } catch {
    return null;
  }
}

export async function resetSession(sessionId: string): Promise<void> {
  if (flags.mockChat) return;

  try {
    await fetch(`${API_BASE}/api/session/reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId }),
    });
  } catch {
    // The client-side transcript is cleared regardless; a stale server
    // session is harmless because we rotate to a fresh id anyway.
  }
}

/**
 * Recent conversations for one scope: a project, or the global chat when
 * `projectId` is omitted. Powers the sidebar's history accordion.
 *
 * Never throws: a history list that fails to load should not take the rest of
 * the sidebar down with it.
 */
export async function fetchChatSessions(
  projectId?: string,
  signal?: AbortSignal,
): Promise<ChatSessionSummary[]> {
  if (flags.mockChat) return [];

  try {
    const url = new URL(`${API_BASE}/api/chat/sessions`);
    if (projectId) url.searchParams.set("project_id", projectId);
    const res = await fetch(url, { signal });
    if (!res.ok) return [];
    const body = (await res.json()) as { sessions: ChatSessionSummary[] };
    return body.sessions ?? [];
  } catch {
    return [];
  }
}

/** The rendered transcript for one past conversation, so it can be reopened. */
export async function fetchChatTranscript(sessionId: string): Promise<StoredMessage[]> {
  if (flags.mockChat) return [];

  try {
    const res = await fetch(`${API_BASE}/api/chat/sessions/${sessionId}`);
    if (!res.ok) return [];
    const body = (await res.json()) as { messages: StoredMessage[] };
    return body.messages ?? [];
  } catch {
    return [];
  }
}
