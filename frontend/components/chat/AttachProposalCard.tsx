"use client";

import { ArrowRight, Check, FolderInput, Loader2, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { useChatPreset } from "@/components/chat/ChatPresetProvider";
import { useChatSession } from "@/components/chat/ChatSessionProvider";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { attachChatSession } from "@/lib/api";
import { projectsApi } from "@/lib/project-api";
import { rotateSessionId, scopeForProject, setSessionId } from "@/lib/session";
import type { TranscriptItem } from "@/lib/types";
import { workspaceChanges } from "@/lib/workspace-changes";

type Proposal = Extract<TranscriptItem, { kind: "attach_proposal" }>;

/**
 * An offer to move this conversation into a project that already exists.
 *
 * The sibling of ProjectProposalCard: that one creates a new project, this one
 * adopts an existing one. The model only proposes -- calling the tool parks the
 * turn (see backend/app/agent/loop.py) -- and the move happens here, so the
 * backend is told "approved" only once it has actually succeeded.
 *
 * Unlike creating a project this is reversible: attaching to null re-files the
 * conversation as global. The copy says so, because a move the user cannot
 * picture undoing is one they will decline.
 */
export default function AttachProposalCard({ item }: { item: Proposal }) {
  const { resolveApprovals, streaming, sessionId, items } = useChatSession();
  const { preset } = useChatPreset();
  const [working, setWorking] = useState(false);
  const [done, setDone] = useState(false);

  // The files this conversation wrote to the scratch workspace. They should
  // travel with it, and the count is shown so "Yes" is never silently a file
  // operation.
  const changes = useMemo(() => workspaceChanges(items), [items]);

  if (done) {
    return (
      <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/5 px-3 py-2.5">
        <p className="text-xs font-medium">
          Filed under <span className="font-mono">{item.projectName}</span>.
        </p>
        <Button asChild size="sm" className="mt-2 h-7 gap-1.5 text-xs">
          <Link href={`/projects/${item.projectId}/vscode`}>
            Open the workspace
            <ArrowRight className="size-3.5" />
          </Link>
        </Button>
      </div>
    );
  }

  if (item.decision) {
    return (
      <p className="px-2 font-mono text-[11px] text-muted-foreground">
        {item.decision === "approved" ? "filing…" : "not now"} ·{" "}
        {item.projectName}
      </p>
    );
  }

  async function accept() {
    if (!sessionId) return;
    setWorking(true);
    try {
      // Bytes first, conversation second -- the same order
      // OpenAsProjectDialog uses. If the attach then fails the files are already in the project,
      // which is visible and correct, and only the chat is still global.
      if (changes.length > 0) {
        const adopted = await projectsApi.adoptWorkspace(item.projectId, {
          paths: changes.map((change) => change.path),
        });
        if (adopted.skipped.length > 0) {
          // Usually a file the project already has -- its own copy wins, which
          // is right. Worth saying, not worth failing over.
          toast.error({
            title: `Brought in ${adopted.copied.length} of ${changes.length} files`,
            description: adopted.skipped
              .slice(0, 3)
              .map((entry) => `${entry.path}: ${entry.reason}`)
              .join("; "),
          });
        }
      }

      await attachChatSession(sessionId, item.projectId);
      // Before anything else reads it: the project's scope adopts this id, and
      // the global chat gets a fresh one so both scopes do not hold the same
      // session and re-split what the attach just joined.
      setSessionId(scopeForProject(item.projectId), sessionId);
      rotateSessionId(null);

      void resolveApprovals([{ id: item.id, approved: true }], preset);
      setDone(true);
    } catch (err) {
      toast.error({
        title: "Could not file the conversation",
        description: (err as Error).message,
      });
      setWorking(false);
    }
  }

  const decline = () =>
    void resolveApprovals([{ id: item.id, approved: false }], preset);

  return (
    <div className="rounded-xl border border-sky-500/40 bg-sky-500/5 px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-xs font-medium">
        <FolderInput className="size-3.5 shrink-0 text-sky-600 dark:text-sky-400" />
        File this conversation under{" "}
        <span className="font-mono">{item.projectName}</span>?
      </p>

      {item.reason && (
        <p className="mt-1 px-0.5 text-[11px] text-muted-foreground">
          {item.reason}
        </p>
      )}

      <p className="mt-1 px-0.5 text-[11px] text-muted-foreground">
        The conversation moves to that project&apos;s chat
        {changes.length > 0
          ? `, along with the ${changes.length} file${changes.length === 1 ? "" : "s"} it wrote`
          : ""}
        . You can move it back later.
      </p>

      <div className="mt-2 flex gap-2">
        <Button
          type="button"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          disabled={streaming || working || !sessionId}
          onClick={() => void accept()}
        >
          {working ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Check className="size-3.5" />
          )}
          File it there
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 text-xs"
          disabled={streaming || working}
          onClick={decline}
        >
          <X className="size-3.5" />
          Not now
        </Button>
      </div>
    </div>
  );
}
