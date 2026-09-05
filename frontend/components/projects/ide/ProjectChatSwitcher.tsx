"use client";

import { Check, ChevronDown, MessageSquare, Plus } from "lucide-react";
import { useEffect, useState } from "react";

import { useChatSession } from "@/components/chat/ChatSessionProvider";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchChatSessions, type ChatSessionSummary } from "@/lib/api";

/**
 * Switch between this project's conversations.
 *
 * MUST be mounted inside the project's ChatSessionProvider, not in the IDE
 * toolbar: the toolbar sits outside that provider, so `useChatSession` there
 * resolves to the global one from app/layout.tsx and this would silently
 * switch the chat on `/` instead. It would look like it worked.
 *
 * Refetches when a turn finishes rather than polling -- `streaming` going false
 * is the one moment the list can have changed, either a new row for a session
 * that just sent its first message or an existing one bumped up by updated_at.
 * Same trigger as the sidebar's ChatHistoryAccordion.
 */
export default function ProjectChatSwitcher({
  projectId,
}: {
  projectId: string;
}) {
  const { sessionId, streaming, openSession, newChat } = useChatSession();
  const [sessions, setSessions] = useState<ChatSessionSummary[] | null>(null);

  useEffect(() => {
    if (streaming) return;
    const controller = new AbortController();
    void fetchChatSessions(projectId, controller.signal).then(setSessions);
    return () => controller.abort();
  }, [streaming, projectId]);

  const active = sessions?.find((s) => s.session_id === sessionId);
  const label = active?.title ?? "This conversation";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 min-w-0 flex-1 justify-start gap-1.5 px-2 text-xs font-normal"
        >
          <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{label}</span>
          <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-72">
        {sessions === null ? (
          <div className="space-y-1 p-1">
            <Skeleton className="h-7 w-full" />
            <Skeleton className="h-7 w-full" />
          </div>
        ) : sessions.length === 0 ? (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">
            No saved conversations yet.
          </p>
        ) : (
          sessions.map((session) => (
            <DropdownMenuItem
              key={session.session_id}
              className="gap-2 text-xs"
              onSelect={() => void openSession(session.session_id)}
            >
              <Check
                className={
                  session.session_id === sessionId
                    ? "size-3.5 shrink-0"
                    : "size-3.5 shrink-0 opacity-0"
                }
              />
              <span className="min-w-0 flex-1 truncate">{session.title}</span>
              <span className="shrink-0 text-[10px] text-muted-foreground">
                {session.message_count}
              </span>
            </DropdownMenuItem>
          ))
        )}

        <DropdownMenuSeparator />
        <DropdownMenuItem className="gap-2 text-xs" onSelect={() => newChat()}>
          <Plus className="size-3.5 shrink-0" />
          New chat in this project
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
