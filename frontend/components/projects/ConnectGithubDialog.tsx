"use client";

import { Loader2, UploadCloud } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import GithubRepoPicker from "@/components/projects/GithubRepoPicker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Credential } from "@/lib/credential-types";
import { projectsApi } from "@/lib/project-api";
import type { RemoteRepo } from "@/lib/project-types";

type Phase = "pick" | "pushing" | "failed";

/**
 * Link a Blank Project to an existing (ideally empty) GitHub repository and
 * push its history to it.
 *
 * Two calls against two servers, same split as project creation: `connect`
 * persists the remote's coordinates (Next.js owns `projects`), then
 * `pushToRemote` does the actual `git remote add` + `push` (only the Python
 * harness has a decrypted token and the working tree to push from).
 */
export default function ConnectGithubDialog({
  projectId,
  credentials,
}: {
  projectId: string;
  credentials: Credential[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("pick");
  const [error, setError] = useState<string | null>(null);

  function onOpenChange(next: boolean) {
    if (phase === "pushing") return;
    setOpen(next);
    if (next) {
      setPhase("pick");
      setError(null);
    }
  }

  async function connectAndPush(repo: RemoteRepo, credentialId: string) {
    setPhase("pushing");
    setError(null);

    try {
      await projectsApi.connect(projectId, {
        repoOwner: repo.owner,
        repoName: repo.name,
        repoUrl: repo.clone_url,
        repoId: repo.id,
        defaultBranch: repo.default_branch,
        visibility: repo.private ? "private" : "public",
        credentialId,
      });
      await projectsApi.pushToRemote(projectId);

      setOpen(false);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setPhase("failed");
    }
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7 px-2 text-xs"
        onClick={() => onOpenChange(true)}
      >
        <UploadCloud className="size-3.5" />
        Connect to GitHub
      </Button>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Connect to GitHub</DialogTitle>
            <DialogDescription>
              Pick an empty repository to push this project&apos;s history to. Pushing to
              a repo that already has commits of its own will fail rather than overwrite
              them.
            </DialogDescription>
          </DialogHeader>

          {phase === "pushing" || phase === "failed" ? (
            <div className="flex flex-col gap-3 py-2">
              <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-3 text-xs">
                {phase === "pushing" ? (
                  <>
                    <Loader2 className="size-3.5 shrink-0 animate-spin" />
                    Linking the remote and pushing…
                  </>
                ) : (
                  "The push did not complete."
                )}
              </div>
              {error && (
                <p
                  role="alert"
                  className="whitespace-pre-wrap rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-700 dark:text-red-300"
                >
                  {error}
                </p>
              )}
            </div>
          ) : (
            <GithubRepoPicker credentials={credentials} onPick={connectAndPush} />
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={phase === "pushing"}
            >
              {phase === "failed" ? "Close" : "Cancel"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
