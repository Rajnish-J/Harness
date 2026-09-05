"use client";

import {
  ChevronDown,
  Download,
  GitBranch,
  GitMerge,
  GitPullRequest,
  Loader2,
  Upload,
} from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { projectGitApi } from "@/lib/project-api";
import type { GitStatus, PullRequest } from "@/lib/project-types";

/** Never rejects, so the effect can pass the setter directly. */
async function loadStatus(projectId: string): Promise<GitStatus | null> {
  try {
    return await projectGitApi.status(projectId);
  } catch {
    return null;
  }
}

type Action = "branch" | "commit" | "pr" | null;

/**
 * Branch, pull, commit-and-push, open a PR, merge it.
 *
 * These are the git verbs the agent is deliberately not given. It can edit
 * files and commit locally through its tools; pulling, pushing and merging are
 * outward facing, so a person presses them here. This is the one place these
 * actions live — "View pull request" used to also sit in RepositoryMenu, which
 * left the same verb in two menus; that duplication is gone.
 *
 * Shape: one "Git" menu plus a single visible Commit & push. The toolbar's
 * right half is already menus (version history, container, repository, share),
 * and five flat buttons here made the left half the only place that grows a
 * button per verb. Commit & push stays out of the menu because it is the one
 * that gets pressed repeatedly; the rest are occasional. Merge still confirms
 * before running, since it is the only action here that changes a branch other
 * people share.
 */
export default function GitHubActionBar({ projectId }: { projectId: string }) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [pulls, setPulls] = useState<PullRequest[]>([]);
  const [action, setAction] = useState<Action>(null);
  const [busy, setBusy] = useState(false);

  const [branchName, setBranchName] = useState("");
  const [commitMessage, setCommitMessage] = useState("");
  const [prTitle, setPrTitle] = useState("");
  const [prBody, setPrBody] = useState("");

  useEffect(() => {
    loadStatus(projectId).then(setStatus);
  }, [projectId]);

  async function refresh() {
    setStatus(await loadStatus(projectId));
  }

  function open(next: Action) {
    setAction(next);
    if (next === "branch") setBranchName("");
    if (next === "commit") setCommitMessage("");
    if (next === "pr") {
      setPrTitle(status?.current_branch ?? "");
      setPrBody("");
    }
  }

  async function loadPulls() {
    try {
      const result = await projectGitApi.listPulls(projectId);
      setPulls(result.pulls);
      if (result.pulls.length === 0) toast.info("No open pull requests.");
    } catch (err) {
      toast.error({
        title: "Could not list pull requests",
        description: (err as Error).message,
      });
    }
  }

  async function run(fn: () => Promise<string | null>) {
    setBusy(true);
    try {
      const message = await fn();
      if (message) toast.success(message);
      setAction(null);
      await refresh();
    } catch (err) {
      toast.error({ title: "Git action failed", description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function mergeNewest() {
    let open: PullRequest[] = pulls;
    if (open.length === 0) {
      try {
        open = (await projectGitApi.listPulls(projectId)).pulls;
        setPulls(open);
      } catch (err) {
        toast.error({ title: "Could not load pull requests", description: (err as Error).message });
        return;
      }
    }

    const target =
      open.find((p) => p.head === status?.current_branch) ?? open[0] ?? null;
    if (!target) {
      toast.warning("No open pull request to merge.");
      return;
    }

    // Merging writes to a branch other people share, so it confirms first.
    if (
      !window.confirm(
        `Merge PR #${target.number} "${target.title}" into ${target.base}? ` +
          "This cannot be undone from here.",
      )
    ) {
      return;
    }

    await run(async () => {
      await projectGitApi.mergePull(projectId, target.number);
      return `Merged #${target.number} into ${target.base}.`;
    });
  }

  return (
    <div className="flex items-center gap-1.5">
      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <GitBranch className="size-3" />
        {status?.current_branch ?? "…"}
        {status?.dirty && <span className="text-amber-600">•</span>}
      </span>

      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-6 gap-1 px-2 text-[11px]"
              >
                Git
                <ChevronDown className="size-3" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Branch, pull and pull requests</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            Branch
          </DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => open("branch")}>
            <GitBranch />
            New branch
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={busy}
            onSelect={() =>
              void run(async () => {
                const r = await projectGitApi.pull(projectId);
                return r.branch ? `Pulled into ${r.branch}.` : "Pulled.";
              })
            }
          >
            <Download />
            Pull
          </DropdownMenuItem>

          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            Pull requests
          </DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => open("pr")}>
            <GitPullRequest />
            Open a pull request
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void loadPulls()}>
            <GitPullRequest />
            View open pull requests
          </DropdownMenuItem>
          <DropdownMenuItem disabled={busy} onSelect={() => void mergeNewest()}>
            <GitMerge />
            Merge newest
          </DropdownMenuItem>

          {pulls.length > 0 && (
            <>
              <DropdownMenuSeparator />
              {pulls.slice(0, 5).map((pull) => (
                <DropdownMenuItem
                  key={pull.number}
                  onSelect={() => window.open(pull.html_url, "_blank", "noopener")}
                >
                  <span className="truncate">
                    #{pull.number} {pull.title}
                  </span>
                </DropdownMenuItem>
              ))}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Out of the menu: the one verb here pressed repeatedly, not occasionally. */}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-6 px-2 text-[11px]"
        onClick={() => open("commit")}
      >
        <Upload className="size-3" />
        Commit &amp; push
      </Button>

      <Dialog open={action !== null} onOpenChange={(o) => !o && setAction(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {action === "branch" && "New branch"}
              {action === "commit" && "Commit and push"}
              {action === "pr" && "Open a pull request"}
            </DialogTitle>
            <DialogDescription>
              {action === "branch" &&
                `Created from ${status?.current_branch ?? "the current branch"}.`}
              {action === "commit" &&
                "Stages everything, commits, and pushes to origin."}
              {action === "pr" &&
                `From ${status?.current_branch ?? "this branch"} into the default branch.`}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2 py-3">
            {action === "branch" && (
              <>
                <Label htmlFor="branch" className="text-xs font-medium">
                  Name
                </Label>
                <Input
                  id="branch"
                  autoFocus
                  value={branchName}
                  placeholder="feat/my-change"
                  onChange={(e) => setBranchName(e.target.value)}
                  disabled={busy}
                />
              </>
            )}
            {action === "commit" && (
              <>
                <Label htmlFor="msg" className="text-xs font-medium">
                  Message
                </Label>
                <Input
                  id="msg"
                  autoFocus
                  value={commitMessage}
                  placeholder="Describe the change"
                  onChange={(e) => setCommitMessage(e.target.value)}
                  disabled={busy}
                />
              </>
            )}
            {action === "pr" && (
              <>
                <Label htmlFor="title" className="text-xs font-medium">
                  Title
                </Label>
                <Input
                  id="title"
                  autoFocus
                  value={prTitle}
                  placeholder="What this changes"
                  onChange={(e) => setPrTitle(e.target.value)}
                  disabled={busy}
                />
                <Label htmlFor="pr-body" className="text-xs font-medium">
                  Description
                </Label>
                <textarea
                  id="pr-body"
                  value={prBody}
                  onChange={(e) => setPrBody(e.target.value)}
                  disabled={busy}
                  rows={4}
                  className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30"
                />
              </>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setAction(null)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  if (action === "branch") {
                    await projectGitApi.createBranch(projectId, branchName.trim());
                    return `Switched to ${branchName.trim()}.`;
                  }
                  if (action === "commit") {
                    const r = await projectGitApi.commit(
                      projectId,
                      commitMessage.trim(),
                    );
                    return r.pushed ? `Pushed to ${r.branch}.` : "Committed locally.";
                  }
                  const pr = await projectGitApi.createPull(projectId, {
                    title: prTitle.trim(),
                    body: prBody.trim(),
                  });
                  return `Opened #${pr.number}.`;
                })
              }
            >
              {busy ? <Loader2 className="size-3 animate-spin" /> : null}
              {action === "branch" && "Create"}
              {action === "commit" && "Commit & push"}
              {action === "pr" && "Open PR"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
