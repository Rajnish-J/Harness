"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useChatSession } from "@/components/chat/ChatSessionProvider";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchChatSessions, type ChatSessionSummary } from "@/lib/api";

/**
 * Previous global conversations, tucked under one accordion item below
 * "New chat".
 *
 * Global only: `fetchChatSessions()` is called with no project id, matching
 * the `ChatSessionProvider` instance that wraps the whole app shell (see
 * app/layout.tsx). A project's own history lives on its own page, scoped to
 * that project's chat, and is deliberately not mixed in here.
 *
 * Refetches when a turn finishes rather than polling: `streaming` flipping
 * back to false is the one moment the list can have actually changed --
 * either a new row for a session that just sent its first message, or an
 * existing row bumped to the top by `updated_at`.
 */
export default function ChatHistoryAccordion() {
  const { sessionId, streaming, openSession } = useChatSession();
  const router = useRouter();
  const pathname = usePathname();
  const [sessions, setSessions] = useState<ChatSessionSummary[] | null>(null);

  useEffect(() => {
    if (streaming) return;
    const controller = new AbortController();
    fetchChatSessions(undefined, controller.signal).then(setSessions);
    return () => controller.abort();
  }, [streaming]);

  function open(id: string) {
    void openSession(id);
    // Same reasoning as NewChatButton: a no-op when already on `/`, but a
    // click from /workflows or /credentials needs to land on the chat.
    if (pathname !== "/") router.push("/");
  }

  return (
    <Accordion
      type="single"
      collapsible
      className="group-data-[collapsible=icon]:hidden"
    >
      <AccordionItem value="history" className="border-b-0">
        <AccordionTrigger className="px-2 py-1.5 text-xs font-medium text-sidebar-foreground/70 hover:no-underline [&>svg]:size-3.5">
          Previous chats
        </AccordionTrigger>
        <AccordionContent className="pb-1">
          {sessions === null ? (
            <div className="flex flex-col gap-1.5 px-2">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
            </div>
          ) : sessions.length === 0 ? (
            <p className="px-2 py-1 text-xs text-muted-foreground">
              No previous chats yet.
            </p>
          ) : (
            <SidebarMenu>
              {sessions.map((session) => (
                <SidebarMenuItem key={session.session_id}>
                  <SidebarMenuButton
                    size="sm"
                    isActive={session.session_id === sessionId}
                    tooltip={session.title}
                    onClick={() => open(session.session_id)}
                  >
                    <span className="truncate">{session.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          )}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
