"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { useChatSession } from "@/components/chat/ChatSessionProvider";
import { projectChatPath } from "@/lib/chat-routes";

/**
 * Keeps `?chat=` and the rail's open conversation pointing at each other.
 *
 * Mounted INSIDE the project's nested ChatSessionProvider, so `useChatSession`
 * resolves to the rail's conversation rather than the global chat on /chat.
 *
 * Two directions, deliberately asymmetric. The URL is read once, on mount: a
 * pasted link names a conversation and must beat whatever this browser last
 * had open. The store is watched forever, because writing the URL from an
 * effect on `sessionId` catches every way the conversation can change --
 * the switcher, "New chat", anything added later -- for free, where a call in
 * each handler would need remembering every time.
 */
export default function ProjectChatUrlSync({
  projectId,
  initialSessionId,
}: {
  projectId: string;
  initialSessionId?: string | null;
}) {
  const { sessionId, adoptSession } = useChatSession();
  const router = useRouter();

  // URL -> store. The ref, not the deps, is what makes this once-only: the
  // user may switch away from the deep-linked chat, and re-adopting it on a
  // later render would drag them back to it.
  const claimed = useRef(false);
  useEffect(() => {
    if (claimed.current || !initialSessionId) return;
    claimed.current = true;
    adoptSession(initialSessionId);
  }, [initialSessionId, adoptSession]);

  // store -> URL.
  useEffect(() => {
    if (!sessionId) return;
    // replace, not push: switching chats in a docked rail is view state inside
    // one page, like changing a tab. push would make Back walk every chat
    // glanced at before it finally left the IDE.
    //
    // This also fires on mount, once localStorage resolves, so a bare
    // /projects/<id>/vscode canonicalises itself into a copy-pasteable URL.
    // It settles after one write: replacing with the same path changes no dep.
    router.replace(projectChatPath(projectId, sessionId), { scroll: false });
  }, [sessionId, projectId, router]);

  return null;
}
