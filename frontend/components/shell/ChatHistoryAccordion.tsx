"use client";

import { Pin } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useChatSession } from "@/components/chat/ChatSessionProvider";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import {
  fetchChatSessions,
  setChatSessionPinned,
  type ChatSessionSummary,
} from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Previous global conversations, tucked under one accordion item below
 * "New chat".
 *
 * Global only: `fetchChatSessions()` is called with no project id, matching
 * the `ChatSessionProvider` instance that wraps the whole app shell (see
 * app/layout.tsx). A project's own history lives on its own page, scoped to
 * that project's chat, and is deliberately not mixed in here.
 *
 * Pinned conversations are split out above the rest. Both groups come from
 * one fetch and keep the server's ordering; pinning writes through and is
 * applied optimistically, since the effect below deliberately does not refetch
 * on anything but a finished turn.
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

  // Partitioned from one fetch rather than fetched twice: list_sessions caps
  // at 50, pins are a handful, and a second round trip would open a window
  // where a chat is in both groups or neither. The order inside each group is
  // the server's -- re-sorting here would let the two orderings drift.
  const pinned = sessions?.filter((session) => session.pinned_at) ?? [];
  const recents = sessions?.filter((session) => !session.pinned_at) ?? [];

  async function togglePin(session: ChatSessionSummary) {
    const next = session.pinned_at ? null : new Date().toISOString();
    const before = sessions;

    // Optimistic: a pin has to feel instant. The rollback matters just as much
    // -- setChatSessionPinned throws, and a silently lost pin is exactly what
    // the endpoint's 503 policy exists to prevent.
    setSessions(
      (prev) =>
        prev?.map((row) =>
          row.session_id === session.session_id
            ? { ...row, pinned_at: next }
            : row,
        ) ?? prev,
    );

    try {
      await setChatSessionPinned(session.session_id, Boolean(next));
    } catch {
      setSessions(before);
      toast.error({ title: "Could not pin the conversation" });
    }
  }

  function renderRow(session: ChatSessionSummary) {
    return (
      <SidebarMenuItem key={session.session_id}>
        <SidebarMenuButton
          size="sm"
          isActive={session.session_id === sessionId}
          tooltip={session.title}
          onClick={() => open(session.session_id)}
        >
          <span className="truncate">{session.title}</span>
        </SidebarMenuButton>
        {/* After the button, never before: SidebarMenuAction positions itself
            with a `peer-` selector that only matches a preceding sibling. It
            also supplies the button's pr-8 via group-has, so none is set here. */}
        <SidebarMenuAction
          showOnHover
          onClick={() => void togglePin(session)}
          title={session.pinned_at ? "Unpin conversation" : "Pin conversation"}
        >
          <Pin className={cn("size-3.5", session.pinned_at && "fill-current")} />
          <span className="sr-only">
            {session.pinned_at ? "Unpin" : "Pin"} conversation
          </span>
        </SidebarMenuAction>
      </SidebarMenuItem>
    );
  }

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
            <>
              {pinned.length > 0 && (
                <>
                  <p className="px-2 pt-1 pb-0.5 text-[11px] font-medium text-sidebar-foreground/70">
                    Pinned
                  </p>
                  <SidebarMenu>{pinned.map(renderRow)}</SidebarMenu>
                  <SidebarSeparator className="mx-2 my-1" />
                  <p className="px-2 pb-0.5 text-[11px] font-medium text-sidebar-foreground/70">
                    Recents
                  </p>
                </>
              )}
              <SidebarMenu>{recents.map(renderRow)}</SidebarMenu>
            </>
          )}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
