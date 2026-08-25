import { consumeSSE } from "./sse";
import type { AgentEvent, HarnessConfig } from "./types";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

/** POST a message and consume the agent's SSE event stream. */
export async function streamChat(
  params: {
    sessionId: string;
    message: string;
    signal?: AbortSignal;
  },
  onEvent: (event: AgentEvent) => void,
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session_id: params.sessionId,
      message: params.message,
    }),
    signal: params.signal,
  });

  await consumeSSE<AgentEvent>(res, onEvent);
}

export async function fetchConfig(
  signal?: AbortSignal,
): Promise<HarnessConfig | null> {
  try {
    const res = await fetch(`${API_BASE}/api/config`, { signal });
    if (!res.ok) return null;
    return (await res.json()) as HarnessConfig;
  } catch {
    return null;
  }
}

export async function resetSession(sessionId: string): Promise<void> {
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
