"use client";

import { Loader2, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import type { Credential } from "@/lib/credential-types";
import { MOCK_ORGS } from "@/lib/mock/ide";
import { projectsApi } from "@/lib/project-api";
import type { Project, RemoteRepo } from "@/lib/project-types";

/**
 * Connect this project to a GitHub repository: organisation, repository, branch.
 *
 * The three selects cascade, which is why they are `Select` and not the button
 * rows used everywhere else in this app: an account's repository list is
 * unbounded, so it has to collapse.
 *
 * Two honest limits, both surfaced in the UI rather than only here:
 *
 * - The repository list is page 1 only. `listRemoteRepos` accepts a page and
 *   nothing passes one, so an account with more than 50 repositories cannot
 *   reach the rest. Same gap the older picker has.
 * - Connecting is one-way. `connectProjectToGithub` guards on
 *   `isNull(repoUrl)`, so an already-connected project cannot be re-pointed or
 *   disconnected. Disconnect is shown because the reference has it, and says
 *   so when pressed rather than silently doing nothing.
 */
export default function ConnectRepositoryDialog({
  project,
  credentials,
  open,
  onOpenChange,
}: {
  project: Project;
  credentials: Credential[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const usable = credentials.filter((credential) => credential.enabled);
  const connected = Boolean(project.repoUrl);

  const [credentialId] = useState(usable[0]?.id ?? "");
  const [org, setOrg] = useState<string>(project.repoOwner ?? "");
  const [repos, setRepos] = useState<RemoteRepo[]>([]);
  const [repoName, setRepoName] = useState<string>(project.repoName ?? "");
  const [branch, setBranch] = useState<string>(project.defaultBranch);
  // Starts true and is only ever cleared from a callback. ProjectIde mounts
  // this component only while the dialog is open, so every open gets fresh
  // state — which is what lets the fetch below avoid a synchronous setState in
  // the effect body (react-hooks/set-state-in-effect) without a loading flag
  // that lies on the first frame.
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);

  // Loads page 1 of what the credential can see. A fetch keyed on a user
  // choice is exactly what an effect is for; every setState it performs
  // happens in a promise callback, never in the body.
  useEffect(() => {
    if (!credentialId) {
      return;
    }
    const controller = new AbortController();
    let active = true;

    projectsApi
      .listRemoteRepos(credentialId, { signal: controller.signal })
      .then((result) => {
        if (!active) return;
        setRepos(result);
        setLoading(false);
      })
      .catch((error: Error) => {
        if (!active) return;
        setLoading(false);
        if (error.name !== "AbortError") {
          toast.error({
            title: "Could not list repositories",
            description: error.message,
          });
        }
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [credentialId]);

  const orgs = Array.from(
    new Set([...MOCK_ORGS.map((o) => o.login), ...repos.map((r) => r.owner)]),
  );
  const reposForOrg = org ? repos.filter((repo) => repo.owner === org) : repos;
  const chosen = reposForOrg.find((repo) => repo.name === repoName);
  const branches = Array.from(
    new Set(
      [chosen?.default_branch, project.defaultBranch, "main"].filter(Boolean),
    ),
  ) as string[];

  async function connect() {
    if (!chosen || !credentialId) return;
    setWorking(true);
    try {
      await projectsApi.connect(project.id, {
        repoOwner: chosen.owner,
        repoName: chosen.name,
        repoUrl: chosen.clone_url,
        repoId: chosen.id,
        defaultBranch: branch || chosen.default_branch,
        visibility: chosen.private ? "private" : "public",
        credentialId,
      });
      await projectsApi.pushToRemote(project.id);
      toast.success(`Connected to ${chosen.owner}/${chosen.name}.`);
      onOpenChange(false);
      router.refresh();
    } catch (error) {
      toast.error({
        title: "Could not connect the repository",
        description: (error as Error).message,
      });
    } finally {
      setWorking(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg border bg-muted">
              <GithubMark />
            </span>
            <div className="min-w-0 flex-1">
              <DialogTitle className="flex items-center gap-2 text-base">
                GitHub
                <StatusPill connected={connected} />
              </DialogTitle>
              <DialogDescription className="text-xs">
                Choose a repository to connect this project.
              </DialogDescription>
            </div>
            {connected && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 shrink-0 px-2 text-xs text-muted-foreground"
                onClick={() =>
                  toast.info({
                    title: "Disconnecting is not supported yet",
                    description:
                      "connectProjectToGithub is a one-way compare-and-set: it only links a project that has no remote.",
                  })
                }
              >
                Disconnect
              </Button>
            )}
          </div>
        </DialogHeader>

        {usable.length === 0 ? (
          <div className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            No enabled credentials. Add a GitHub token on the Credentials page
            first.
          </div>
        ) : (
          <div className="flex flex-col gap-4 py-1">
            <Field label="Organization">
              <Select value={org} onValueChange={setOrg} disabled={working}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Select organization" />
                </SelectTrigger>
                <SelectContent>
                  {orgs.map((login) => (
                    <SelectItem key={login} value={login}>
                      {login}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field
              label="Repository"
              action={
                <NewButton
                  what="Creating a repository"
                  detail="Nothing calls the create-repo API yet."
                />
              }
            >
              <Select
                value={repoName}
                onValueChange={setRepoName}
                disabled={working || loading || reposForOrg.length === 0}
              >
                <SelectTrigger className="h-9">
                  <SelectValue
                    placeholder={
                      loading
                        ? "Loading repositories…"
                        : reposForOrg.length === 0
                          ? "No repositories found"
                          : "Select repository"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {reposForOrg.map((repo) => (
                    <SelectItem key={repo.id} value={repo.name}>
                      {repo.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {repos.length >= 50 && (
                <p className="text-[11px] text-muted-foreground">
                  Showing the first 50. Paging is not wired up yet.
                </p>
              )}
            </Field>

            <Field
              label="Branch"
              action={
                <NewButton
                  what="Creating a branch from here"
                  detail="Use the git bar in the toolbar. POST /branches already exists."
                />
              }
            >
              <Select
                value={branch}
                onValueChange={setBranch}
                disabled={working || !chosen}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Select branch" />
                </SelectTrigger>
                <SelectContent>
                  {branches.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <div className="flex justify-end gap-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onOpenChange(false)}
                disabled={working}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={connect}
                disabled={!chosen || working || connected}
              >
                {working && <Loader2 className="size-3.5 animate-spin" />}
                {working ? "Connecting…" : "Connect"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The GitHub mark, inline.
 *
 * lucide-react dropped its brand icons in v1, so there is no `Github` export to
 * import any more. One path is cheaper than adding an icon dependency for it.
 */
function GithubMark() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-4 fill-current"
      aria-hidden
      focusable="false"
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

function StatusPill({ connected }: { connected: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
        connected
          ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
          : "bg-muted text-muted-foreground"
      }`}
    >
      <span
        aria-hidden
        className={`size-1.5 rounded-full ${
          connected ? "bg-emerald-500" : "bg-muted-foreground/40"
        }`}
      />
      {connected ? "Connected" : "Not connected"}
    </span>
  );
}

function Field({
  label,
  action,
  children,
}: {
  label: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          {label}
        </Label>
        {action}
      </div>
      {children}
    </div>
  );
}

/** The "+ New" affordances from the reference. Present, and honest about it. */
function NewButton({ what, detail }: { what: string; detail: string }) {
  return (
    <Button
      variant="ghost"
      size="xs"
      className="h-5 gap-0.5 px-1 text-[11px] text-muted-foreground"
      onClick={() =>
        toast.info({ title: `${what} is not wired up yet`, description: detail })
      }
    >
      <Plus className="size-3" />
      New
    </Button>
  );
}
