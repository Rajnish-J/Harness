"use client";

import { ArrowRight, FilePen, FilePlus, FolderPlus, Loader2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { useChatSession } from "@/components/chat/ChatSessionProvider";
import TemplatePicker, {
  useProjectTemplates,
} from "@/components/projects/TemplatePicker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import { attachChatSession } from "@/lib/api";
import { projectsApi } from "@/lib/project-api";
import { rotateSessionId, scopeForProject, setSessionId } from "@/lib/session";
import type { TranscriptItem } from "@/lib/types";
import type { WorkspaceChange } from "@/lib/workspace-changes";

/**
 * Turn this conversation into a project, on demand.
 *
 * This was a card that appeared unbidden above the composer whenever the agent
 * had written a file. The flow was right and the interruption was not, so it
 * moved behind the chat menu -- nothing lands in the transcript that the user
 * did not ask for.
 *
 * The ordering inside `create` is load-bearing and is preserved exactly from
 * that card; each step's comment says why.
 */

const ICONS: Record<WorkspaceChange["action"], typeof FilePlus> = {
  created: FilePlus,
  edited: FilePen,
  moved: ArrowRight,
  deleted: FilePen,
};

const MAX_LISTED = 12;

/** "build me an expense tracker" -> "build-me-an-expense" */
function slugFromFirstMessage(items: TranscriptItem[]): string {
  const first = items.find((item) => item.kind === "user");
  const text = first && "text" in first ? first.text : "";
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .split(/\s+/)
      .slice(0, 4)
      .join("-")
      .slice(0, 40) || "new-project"
  );
}

export default function OpenAsProjectDialog({
  open,
  onOpenChange,
  changes,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  changes: WorkspaceChange[];
}) {
  const { sessionId, items, streaming } = useChatSession();
  const templates = useProjectTemplates();

  const [name, setName] = useState<string | null>(null);
  const [template, setTemplate] = useState("blank");
  const [working, setWorking] = useState(false);
  const [created, setCreated] = useState<{ id: string; name: string } | null>(
    null,
  );

  const projectName = name ?? slugFromFirstMessage(items);
  const listed = changes.slice(0, MAX_LISTED);
  const overflow = changes.length - listed.length;

  async function create() {
    const trimmed = projectName.trim();
    if (!trimmed || !sessionId) return;

    setWorking(true);
    try {
      const project = await projectsApi.create({ kind: "blank", name: trimmed });
      await projectsApi.init(project.id, template);

      // Bytes first, conversation second. If the attach fails after this, the
      // files are already in the project -- visible and correct -- and only the
      // chat is still global, which is recoverable.
      const adopted = await projectsApi.adoptWorkspace(project.id, {
        paths: changes.map((change) => change.path),
      });
      await attachChatSession(sessionId, project.id);

      // Hand the id to the project's scope BEFORE navigating, or the IDE mounts
      // its provider and mints a fresh session instead of adopting this one.
      setSessionId(scopeForProject(project.id), sessionId);
      // And give `/` a new one, or both scopes hold the same id and the next
      // message here re-splits what the attach just joined.
      rotateSessionId(null);

      if (adopted.skipped.length > 0) {
        toast.error({
          title: `Brought in ${adopted.copied.length} of ${changes.length} files`,
          description: adopted.skipped
            .slice(0, 3)
            .map((s) => `${s.path}: ${s.reason}`)
            .join("; "),
        });
      }
      setCreated({ id: project.id, name: trimmed });
    } catch (err) {
      toast.error({
        title: "Could not create the project",
        description: (err as Error).message,
      });
    } finally {
      setWorking(false);
    }
  }

  // Not auto-closed on success: the link below is the whole payoff, and
  // dismissing the dialog out from under it would strand the user on `/` with
  // a project they have no obvious way back to.
  if (created) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Project created</DialogTitle>
            <DialogDescription>
              <span className="font-mono">{created.name}</span> has the files
              and this conversation. The chat here starts fresh.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button asChild>
              <Link href={`/projects/${created.id}/vscode`}>
                Open the workspace
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Open this chat as a project</DialogTitle>
          <DialogDescription>
            {changes.length > 0
              ? "These files live in the shared scratch workspace. A project gives them their own git repository and editor, and this conversation moves with them."
              : "This chat has not written any files yet. A project still gives it a git repository, an editor, and a home of its own."}
          </DialogDescription>
        </DialogHeader>

        {listed.length > 0 && (
          <ul className="max-h-48 space-y-0.5 overflow-y-auto rounded-md border p-2">
            {listed.map((change) => {
              const Icon = ICONS[change.action];
              return (
                <li
                  key={change.path}
                  className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground"
                >
                  <Icon className="size-3 shrink-0" />
                  <span className="truncate">{change.path}</span>
                </li>
              );
            })}
            {overflow > 0 && (
              <li className="pl-4.5 text-[11px] text-muted-foreground">
                and {overflow} more
              </li>
            )}
          </ul>
        )}

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="open-as-project-name" className="text-xs font-medium">
              Name
            </Label>
            <Input
              id="open-as-project-name"
              value={projectName}
              onChange={(event) => setName(event.target.value)}
              placeholder="project-name"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-medium">Scaffold</Label>
            <TemplatePicker
              templates={templates}
              value={template}
              onChange={setTemplate}
              disabled={working}
            />
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={working}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="button"
            // Mid-stream the file list is still growing; creating now would
            // adopt a partial set of whatever the turn is in the middle of.
            disabled={working || streaming || !projectName.trim() || !sessionId}
            onClick={() => void create()}
          >
            {working ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <FolderPlus className="size-4" />
            )}
            Create project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
