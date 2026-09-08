/**
 * Browser client for the global tool disable list.
 *
 * Its own module rather than the crud() factory in registry-api.ts: there is no
 * id-addressed resource here, just one list and one partial write.
 *
 * The two halves deliberately fail differently. Reading swallows failures into
 * an empty list, the way fetchTools does — if this route is down, the composer
 * should not lock every tool it knows about. That fail-open is only safe
 * because the harness enforces the same list server-side, in _prepare_turn, so
 * a browser that failed open still cannot spend a disabled tool. Writing
 * throws, the way testMcpServer does: a switch the user just flipped must say
 * so when it does not stick.
 */

export type ToolSettings = {
  /** Tool names switched off for every turn. Sorted. */
  disabled: string[];
};

const NONE: ToolSettings = { disabled: [] };

export async function fetchToolSettings(
  signal?: AbortSignal,
): Promise<ToolSettings> {
  try {
    const res = await fetch("/api/tool-settings", { signal });
    if (!res.ok) return NONE;
    const payload = (await res.json()) as Partial<ToolSettings>;
    return { disabled: payload.disabled ?? [] };
  } catch {
    return NONE;
  }
}

/** Switch tools on or off, and take the server's list as authoritative. */
export async function setToolsEnabled(
  names: string[],
  enabled: boolean,
): Promise<ToolSettings> {
  const res = await fetch("/api/tool-settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ names, enabled }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as { error?: string }).error ?? `Request failed: ${res.status}`,
    );
  }

  const payload = (await res.json()) as Partial<ToolSettings>;
  return { disabled: payload.disabled ?? [] };
}
