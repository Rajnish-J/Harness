"use client";

import { ClipboardCopy, FolderPlus, Link2, MoreVertical } from "lucide-react";
import { useMemo, useState } from "react";

import { useChatSession } from "@/components/chat/ChatSessionProvider";
import OpenAsProjectDialog from "@/components/chat/OpenAsProjectDialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { copyWithToast } from "@/lib/copy-with-toast";
import { transcriptToMarkdown } from "@/lib/transcript-markdown";
import { workspaceChanges } from "@/lib/workspace-changes";
import { cn } from "@/lib/utils";

/**
 * Chat-level actions, on the global chat only.
 *
 * Mounted in AppHeader, which renders above EVERY route -- including the
 * project IDE -- so the caller gates it on the route. That gate is
 * load-bearing rather than cosmetic: the header sits outside ProjectIde's
 * nested provider, so on a project page `useChatSession` here would resolve to
 * the GLOBAL chat and every item would act on the wrong conversation.
 *
 * "Open this chat as a project" used to be a card above the composer that
 * appeared on its own whenever a file had been written. It lives here now so
 * the transcript stays the conversation and nothing else.
 */
export default function ChatActionsMenu() {
  const { sessionId, items } = useChatSession();
  const [dialogOpen, setDialogOpen] = useState(false);

  // Computed once here and handed to the dialog: it decides the sub-line and
  // the dot below, and the dialog needs the same list to adopt.
  const changes = useMemo(() => workspaceChanges(items), [items]);
  const empty = items.length === 0;

  function share() {
    if (!sessionId) return;
    // Read at click time, never in render: AppHeader is server-rendered on
    // every route and touching `window` in a render body is a hydration crash.
    // origin rather than a hardcoded host, so the link follows whatever domain
    // this is served from later.
    const link = `${window.location.origin}/?session=${encodeURIComponent(sessionId)}`;
    void copyWithToast(link, "Chat link");
  }

  function copyMarkdown() {
    void copyWithToast(transcriptToMarkdown(items), "Chat");
  }

  return (
    <>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            {/* TooltipTrigger outside DropdownMenuTrigger, both asChild: this
                is what lets the two primitives compose onto one Button.
                Inverted, the dropdown's ref wins and the tooltip never fires. */}
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="relative text-muted-foreground"
              >
                <MoreVertical />
                {/* The card this menu replaced announced itself. A dot is what
                    is left of that invitation: it costs no chat real estate
                    and still says "there is something worth doing here". */}
                {changes.length > 0 && (
                  <span
                    className={cn(
                      "absolute right-1 top-1 size-1.5 rounded-full",
                      "bg-amber-500",
                    )}
                  />
                )}
                <span className="sr-only">Chat menu</span>
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Chat menu</TooltipContent>
        </Tooltip>

        <DropdownMenuContent align="end" className="w-72 p-1">
          <DropdownMenuItem
            className="gap-2.5 py-2"
            disabled={!sessionId || empty}
            onSelect={share}
          >
            <Link2 />
            <span className="flex min-w-0 flex-col">
              <span className="text-sm">Share chat</span>
              <span className="text-[11px] text-muted-foreground">
                Copy a link that reopens this conversation
              </span>
            </span>
          </DropdownMenuItem>

          <DropdownMenuItem
            className="gap-2.5 py-2"
            disabled={empty}
            onSelect={copyMarkdown}
          >
            <ClipboardCopy />
            <span className="flex min-w-0 flex-col">
              <span className="text-sm">Copy chat as Markdown</span>
              <span className="text-[11px] text-muted-foreground">
                The full transcript, ready to paste
              </span>
            </span>
          </DropdownMenuItem>

          <DropdownMenuItem
            className="gap-2.5 py-2"
            disabled={empty}
            onSelect={() => setDialogOpen(true)}
          >
            <FolderPlus />
            <span className="flex min-w-0 flex-col">
              <span className="text-sm">Open this chat as a project</span>
              <span className="text-[11px] text-muted-foreground">
                {empty
                  ? "Start a conversation first"
                  : changes.length > 0
                    ? `Keep the ${changes.length} file${changes.length === 1 ? "" : "s"} it wrote`
                    : "No files written yet — the project starts empty"}
              </span>
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* A sibling of the dropdown, not a child of its content: a Radix dialog
          nested inside a menu is a focus-management minefield. */}
      <OpenAsProjectDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        changes={changes}
      />
    </>
  );
}
