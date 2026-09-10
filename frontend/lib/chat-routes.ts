/**
 * Where a conversation lives.
 *
 * Chat URLs are built in exactly one place, for the same reason nav.ts exists:
 * the id is woven into the sidebar's rows, the header's share item, the deep
 * link drain, and the project rail, and hand-written template literals in five
 * files is five places to forget `encodeURIComponent`.
 *
 * This is separate from lib/session.ts on purpose -- that module owns
 * localStorage and knows nothing about routing, and it should stay that way.
 */

/** The canonical URL for a global chat. */
export function chatPath(sessionId: string): string {
  return `/chat/${encodeURIComponent(sessionId)}`;
}

/**
 * A project's IDE, optionally pointed at one of its conversations.
 *
 * The session travels as a query param rather than a path segment because the
 * conversation is one pane of the IDE, not the page's identity -- the project
 * is. Omitting it is a valid URL that opens the project's newest chat.
 */
export function projectChatPath(projectId: string, sessionId?: string | null): string {
  const base = `/projects/${projectId}/vscode`;
  return sessionId ? `${base}?chat=${encodeURIComponent(sessionId)}` : base;
}
