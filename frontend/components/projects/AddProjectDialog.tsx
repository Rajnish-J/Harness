"use client";

import { GitBranch, Loader2, Lock, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

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
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Credential } from "@/lib/credential-types";
import { projectsApi } from "@/lib/project-api";
import type { CloneEvent, RemoteRepo } from "@/lib/project-types";

/**
 * Pick a credential, pick a repository, clone it.
 *
 * The dialog stays open through the clone rather than navigating away on
 * create, because the clone is the part that can fail — on a bad token, a
 * missing repo, no network — and a failure needs somewhere to be reported. The
 * project row exists before the clone starts, so a failure leaves something to
 * retry rather than nothing at all.
 */
type Phase = "pick" | "cloning" | "failed";

export default function AddProjectDialog({
  credentials,
}: {
  credentials: Credential[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("pick");
  const [credentialId, setCredentialId] = useState<string>(
    credentials[0]?.id ?? "",
  );
  const [repos, setRepos] = useState<RemoteRepo[]>([]);
  const [search, setSearch] = useState("");
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [progress, setProgress] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  function onOpenChange(next: boolean) {
    // Closing mid-clone would leave the stream orphaned and the operator with
    // no idea whether it finished, so the dialog is locked while it runs.
    if (phase === "cloning") return;
    setOpen(next);
    if (next) {
      setPhase("pick");
      setRepos([]);
      setSearch("");
      setProgress([]);
      setError(null);
      setCredentialId(credentials[0]?.id ?? "");
    }
  }

  async function loadRepos(id: string) {
    if (!id) return;
    setLoadingRepos(true);
    setError(null);
    try {
      setRepos(await projectsApi.listRemoteRepos(id));
    } catch (err) {
      setError((err as Error).message);
      setRepos([]);
    } finally {
      setLoadingRepos(false);
    }
  }

  function chooseCredential(id: string) {
    setCredentialId(id);
    setRepos([]);
    void loadRepos(id);
  }

  async function addRepo(repo: RemoteRepo) {
    setPhase("cloning");
    setError(null);
    setProgress([`Creating project for ${repo.full_name}…`]);

    try {
      const project = await projectsApi.create({
        name: repo.name,
        repoOwner: repo.owner,
        repoName: repo.name,
        repoUrl: repo.clone_url,
        repoId: repo.id,
        defaultBranch: repo.default_branch,
        visibility: repo.private ? "private" : "public",
        credentialId,
      });

      let failed: string | null = null;
      await projectsApi.clone(project.id, (event: CloneEvent) => {
        if (event.type === "clone_progress") {
          setProgress((prev) => [...prev, event.message]);
        } else if (event.type === "clone_error") {
          failed = event.message;
        }
      });

      if (failed) {
        setError(failed);
        setPhase("failed");
        // The row exists and is marked errored, so the list can offer a retry.
        router.refresh();
        return;
      }

      setOpen(false);
      setPhase("pick");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setPhase("failed");
      router.refresh();
    }
  }

  const filtered = search.trim()
    ? repos.filter((repo) =>
        repo.full_name.toLowerCase().includes(search.trim().toLowerCase()),
      )
    : repos;

  const usable = credentials.filter((credential) => credential.enabled);

  return (
    <>
      <Button type="button" size="sm" onClick={() => onOpenChange(true)}>
        <Plus />
        Add project
      </Button>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add a project</DialogTitle>
            <DialogDescription>
              Clone a repository into the harness workspace so the agent can work
              inside it.
            </DialogDescription>
          </DialogHeader>

          {usable.length === 0 ? (
            <div className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              No enabled credentials. Add a GitHub token on the{" "}
              <Link className="underline" href="/credentials">
                Credentials
              </Link>{" "}
              page first.
            </div>
          ) : phase === "cloning" || phase === "failed" ? (
            <div className="flex flex-col gap-3 py-2">
              <div className="rounded-lg border bg-muted/30 p-3 font-mono text-xs">
                {progress.map((line, index) => (
                  <div key={index} className="flex items-start gap-2">
                    <span className="text-muted-foreground">›</span>
                    <span>{line}</span>
                  </div>
                ))}
                {phase === "cloning" && (
                  <div className="mt-1 flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="size-3 animate-spin" />
                    working…
                  </div>
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
            <div className="flex flex-col gap-3 py-2">
              <div className="flex flex-col gap-2">
                <Label className="text-xs font-medium">Credential</Label>
                <div className="flex flex-wrap gap-2">
                  {usable.map((credential) => (
                    <button
                      key={credential.id}
                      type="button"
                      onClick={() => chooseCredential(credential.id)}
                      className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
                        credentialId === credential.id
                          ? "border-primary bg-primary text-primary-foreground"
                          : "hover:bg-accent"
                      }`}
                    >
                      {credential.name}
                    </button>
                  ))}
                </div>
              </div>

              {repos.length === 0 && !loadingRepos && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="self-start"
                  onClick={() => loadRepos(credentialId)}
                  disabled={!credentialId}
                >
                  <Search />
                  Load repositories
                </Button>
              )}

              {loadingRepos && (
                <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Asking GitHub…
                </div>
              )}

              {repos.length > 0 && (
                <>
                  <Input
                    autoFocus
                    value={search}
                    placeholder="Filter repositories…"
                    onChange={(event) => setSearch(event.target.value)}
                  />
                  <ScrollArea className="h-72 rounded-md border">
                    <div className="flex flex-col p-1">
                      {filtered.map((repo) => (
                        <button
                          key={repo.id}
                          type="button"
                          onClick={() => addRepo(repo)}
                          className="flex items-start gap-2 rounded px-2 py-2 text-left hover:bg-accent"
                        >
                          <GitBranch className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5">
                              <span className="truncate text-xs font-medium">
                                {repo.full_name}
                              </span>
                              {repo.private && (
                                <Lock className="size-3 shrink-0 text-muted-foreground" />
                              )}
                            </span>
                            {repo.description && (
                              <span className="block truncate text-[11px] text-muted-foreground">
                                {repo.description}
                              </span>
                            )}
                          </span>
                        </button>
                      ))}
                      {filtered.length === 0 && (
                        <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                          Nothing matches “{search}”.
                        </p>
                      )}
                    </div>
                  </ScrollArea>
                </>
              )}

              {error && (
                <p className="text-xs text-destructive" role="alert">
                  {error}
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={phase === "cloning"}
            >
              {phase === "failed" ? "Close" : "Cancel"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
