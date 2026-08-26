import { presetToBody, type ChatPreset } from "./chat-preset";
import { flags } from "./flags";
import { streamMockChat } from "./mock/chat";
import { consumeSSE } from "./sse";
import type { AgentEvent, HarnessConfig } from "./types";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

/** POST a message and consume the agent's SSE event stream. */
export async function streamChat(
  params: {
    sessionId: string;
    message: string;
    preset?: ChatPreset;
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
