const STORAGE_KEY = "harness_session_id";

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `sess-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * The session id is the only thing tying successive requests to the same
 * server-side conversation history. It lives in localStorage so a refresh
 * keeps the backend conversation, even though the visible transcript resets
 * (there is no history endpoint in this milestone).
 *
 * Storage can throw in private-browsing modes, so every access is guarded.
 */
export function getOrCreateSessionId(): string {
  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing) return existing;
    const created = newId();
    window.localStorage.setItem(STORAGE_KEY, created);
    return created;
  } catch {
    return newId();
  }
}

export function rotateSessionId(): string {
  const created = newId();
  try {
    window.localStorage.setItem(STORAGE_KEY, created);
  } catch {
    // Non-persistent session is still a usable session.
  }
  return created;
}
