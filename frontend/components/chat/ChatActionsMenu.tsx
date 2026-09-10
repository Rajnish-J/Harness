"use client";

import { ClipboardCopy, FolderPlus, Link2, MoreVertical, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { useChatSession } from "@/components/chat/ChatSessionProvider";
import DeleteChatDialog from "@/components/chat/DeleteChatDialog";
import OpenAsProjectDialog from "@/components/chat/OpenAsProjectDialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "@/components/ui/toast";
import { deleteChatSession } from "@/lib/api";
import { chatPath } from "@/lib/chat-routes";
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
  const { sessionId, items, newChat } = useChatSession();
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

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
    const link = `${window.location.origin}${chatPath(sessionId)}`;
    void copyWithToast(link, "Chat link");
  }

  function copyMarkdown() {
    void copyWithToast(transcriptToMarkdown(items), "Chat");
  }

  async function remove() {
    if (!sessionId) return;
    try {
      await deleteChatSession(sessionId);
    } catch {
      toast.error({ title: "Could not delete the conversation" });
      // Rethrown so the dialog stays open on its own terms rather than
      // guessing from a return value.
      throw new Error("delete failed");
    }
    // Only after the row is gone: newChat rotates to a fresh id and clears the
    // transcript, so doing it first would strand the operator on a blank chat
    // if the delete then failed.
    //
    // The URL still names the deleted chat, so it has to move too, or a
    // refresh adopts the dead id straight back. replace, so the Back button
    // cannot return to it either.
    router.replace(chatPath(newChat()));
    toast.success({ title: "Chat deleted" });
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

        {/* One line per item. The sub-lines these used to carry explained
            actions whose labels already say the same thing; what they cost was
            a menu three times taller than the four things in it. The one
            genuinely dynamic sub-line -- how many files "Open as a project"
            would keep -- is still on screen as the amber dot above. */}
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem disabled={!sessionId || empty} onSelect={share}>
            <Link2 />
            Share chat
          </DropdownMenuItem>

          <DropdownMenuItem disabled={empty} onSelect={copyMarkdown}>
            <ClipboardCopy />
            Copy chat as Markdown
          </DropdownMenuItem>

          <DropdownMenuItem
            disabled={empty}
            onSelect={() => setDialogOpen(true)}
          >
            <FolderPlus />
            Open this chat as a project
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem
            variant="destructive"
            disabled={!sessionId || empty}
            onSelect={() => setDeleteOpen(true)}
          >
            <Trash2 />
            Delete chat
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

      <DeleteChatDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={remove}
      />
    </>
  );
}
