"use client";

import { GitBranch, GitMerge, GitPullRequest, Loader2, Upload } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
 * Branch, commit-and-push, open a PR, merge it.
 *
 * These are the git verbs the agent is deliberately not given. It can edit
 * files and commit locally through its tools; pushing and merging are outward
 * facing, so a person presses them here. Merge asks for confirmation because it
 * is the only one that changes a branch other people share.
 */
export default function GitHubActionBar({ projectId }: { projectId: string }) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [pulls, setPulls] = useState<PullRequest[]>([]);
  const [action, setAction] = useState<Action>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [branchName, setBranchName] = useState("");
  const [commitMessage, setCommitMessage] = useState("");
  const [prTitle, setPrTitle] = useState("");

  useEffect(() => {
    loadStatus(projectId).then(setStatus);
  }, [projectId]);

  async function refresh() {
    setStatus(await loadStatus(projectId));
  }

  function open(next: Action) {
    setAction(next);
    setError(null);
    setNotice(null);
    if (next === "branch") setBranchName("");
    if (next === "commit") setCommitMessage("");
    if (next === "pr") setPrTitle(status?.current_branch ?? "");
  }

  async function run(fn: () => Promise<string | null>) {
    setBusy(true);
    setError(null);
    try {
      const message = await fn();
      setNotice(message);
      setAction(null);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
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
        setNotice(null);
        setError((err as Error).message);
        return;
      }
    }

    const target =
      open.find((p) => p.head === status?.current_branch) ?? open[0] ?? null;
    if (!target) {
      setError("No open pull request to merge.");
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

      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-6 px-2 text-[11px]"
        onClick={() => open("branch")}
      >
        Branch
      </Button>
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
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-6 px-2 text-[11px]"
        onClick={() => open("pr")}
      >
        <GitPullRequest className="size-3" />
        PR
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-6 px-2 text-[11px]"
        disabled={busy}
        onClick={() => void mergeNewest()}
      >
        <GitMerge className="size-3" />
        Merge
      </Button>

      {notice && (
        <span className="truncate text-[11px] text-emerald-700 dark:text-emerald-300">
          {notice}
        </span>
      )}
      {error && !action && (
        <span className="truncate text-[11px] text-destructive">{error}</span>
      )}

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
              </>
            )}
            {error && (
              <p className="whitespace-pre-wrap text-xs text-destructive" role="alert">
                {error}
              </p>
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
