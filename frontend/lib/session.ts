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

// ---------------------------------------------------------------------------
// External store
//
// localStorage is browser-only, so the id cannot be read during a server
// render. Exposing it as a useSyncExternalStore source rather than resolving it
// in an effect gives React a proper server snapshot (null) to hydrate against,
// and avoids the cascading render that a setState-in-effect would cause.
// ---------------------------------------------------------------------------

let cached: string | null = null;
const listeners = new Set<() => void>();

export function subscribeSessionId(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Browser snapshot. Memoised because useSyncExternalStore re-reads it on every
 * render and would loop forever on a fresh value each time.
 */
export function getSessionIdSnapshot(): string {
  if (cached === null) cached = getOrCreateSessionId();
  return cached;
}

/** Server snapshot: no localStorage, so no session id yet. */
export function getServerSessionIdSnapshot(): string | null {
  return null;
}

export function rotateSessionId(): string {
  const created = newId();
  try {
    window.localStorage.setItem(STORAGE_KEY, created);
  } catch {
    // Non-persistent session is still a usable session.
  }
  cached = created;
  for (const listener of listeners) listener();
  return created;
}
