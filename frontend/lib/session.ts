/**
 * Session ids, one per conversation scope.
 *
 * There used to be exactly one: a single `harness_session_id` in localStorage,
 * because there was a single chat. A project page hosts its own chat, and it
 * must not be the same conversation as the one on `/` — so the store is keyed
 * by scope, and each scope gets its own id, its own storage key, and its own
 * listener set.
 *
 * Per-scope listeners matter: rotating a project's session must not re-render
 * the global chat, and vice versa. One shared listener set would wake every
 * mounted chat on any "New chat" press.
 */

const BASE_KEY = "harness_session_id";

/** `null` is the global chat; anything else namespaces beneath it. */
export type SessionScope = string | null;

export function scopeForProject(projectId: string): SessionScope {
  return `project:${projectId}`;
}

function storageKey(scope: SessionScope): string {
  return scope ? `${BASE_KEY}:${scope}` : BASE_KEY;
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `sess-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * The session id is the only thing tying successive requests to the same
 * server-side conversation history. It lives in localStorage so a refresh keeps
 * the backend conversation.
 *
 * Storage can throw in private-browsing modes, so every access is guarded.
 */
export function getOrCreateSessionId(scope: SessionScope = null): string {
  const key = storageKey(scope);
  try {
    const existing = window.localStorage.getItem(key);
    if (existing) return existing;
    const created = newId();
    window.localStorage.setItem(key, created);
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

/** Memoised per scope: useSyncExternalStore re-reads the snapshot on every
 *  render and would loop forever on a fresh value each time. */
const cached = new Map<string, string>();
const listeners = new Map<string, Set<() => void>>();

function listenersFor(key: string): Set<() => void> {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  return set;
}

export function subscribeSessionId(
  scope: SessionScope,
  listener: () => void,
): () => void {
  const key = storageKey(scope);
  const set = listenersFor(key);
  set.add(listener);
  return () => {
    set.delete(listener);
  };
}

export function getSessionIdSnapshot(scope: SessionScope = null): string {
  const key = storageKey(scope);
  let value = cached.get(key);
  if (value === undefined) {
    value = getOrCreateSessionId(scope);
    cached.set(key, value);
  }
  return value;
}

/** Server snapshot: no localStorage, so no session id yet. */
export function getServerSessionIdSnapshot(): string | null {
  return null;
}

export function rotateSessionId(scope: SessionScope = null): string {
  const key = storageKey(scope);
  const created = newId();
  try {
    window.localStorage.setItem(key, created);
  } catch {
    // Non-persistent session is still a usable session.
  }
  cached.set(key, created);
  // Only this scope's subscribers: a new project chat must not disturb `/`.
  for (const listener of listenersFor(key)) listener();
  return created;
}

/**
 * Adopt an EXISTING session id — reopening a past conversation from the
 * history list, as opposed to `rotateSessionId` minting a fresh one for "New
 * chat". Same body otherwise: same storage write, same scope-local listener
 * notification.
 */
export function setSessionId(scope: SessionScope, id: string): void {
  const key = storageKey(scope);
  try {
    window.localStorage.setItem(key, id);
  } catch {
    // Non-persistent session is still a usable session.
  }
  cached.set(key, id);
  for (const listener of listenersFor(key)) listener();
}
