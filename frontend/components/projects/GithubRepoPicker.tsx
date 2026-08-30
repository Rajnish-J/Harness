"use client";

import { GitBranch, Loader2, Lock, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "@/components/ui/toast";
import CredentialPicker from "@/components/projects/CredentialPicker";
import type { Credential } from "@/lib/credential-types";
import { projectsApi } from "@/lib/project-api";
import type { RemoteRepo } from "@/lib/project-types";

/** "idle" only ever means there is no GitHub credential to load from. */
type Status = "idle" | "loading" | "loaded" | "error";

/**
 * Pick a credential, then a repository it can see.
 *
 * Shared by NewProjectDialog's "Import from GitHub" step and
 * ConnectGithubDialog: both need the exact same "which account, which repo"
 * choice, just followed by a different action once one is picked.
 *
 * The selected credential's repositories load on open rather than behind a
 * button. The chip is already rendered as chosen, so asking the operator to
 * confirm that choice was a click that told us nothing — and with a single
 * token there is no choice to confirm at all, which is why the chip row is
 * dropped in that case.
 */
export default function GithubRepoPicker({
  credentials,
  onPick,
  disabled = false,
}: {
  credentials: Credential[];
  onPick: (repo: RemoteRepo, credentialId: string) => void;
  disabled?: boolean;
}) {
  // Only a GitHub token can answer /api/projects/github/repos. Offering an
  // Azure DevOps or generic credential here just moves the failure to after
  // the click.
  const usable = credentials.filter(
    (credential) => credential.enabled && credential.provider === "github",
  );
  const soleCredential = usable.length === 1 ? usable[0] : null;

  const [credentialId, setCredentialId] = useState<string>(usable[0]?.id ?? "");
  const [repos, setRepos] = useState<RemoteRepo[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<Status>(usable[0] ? "loading" : "idle");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!credentialId) return;
    const controller = new AbortController();

    projectsApi
      .listRemoteRepos(credentialId, { signal: controller.signal })
      .then((next) => {
        setRepos(next);
        setStatus("loaded");
      })
      .catch((err: Error) => {
        // Strict Mode double-mounts in dev, so the first request is aborted by
        // this effect's own cleanup. That is not a failure worth a toast.
        if (controller.signal.aborted) return;
        toast.error({ title: "Could not load repositories", description: err.message });
        setStatus("error");
      });

    return () => controller.abort();
  }, [credentialId, reloadKey]);

  // The reset belongs to the click, not to the effect: a state transition
  // caused by an event is not something to synchronize after the fact.
  function selectCredential(next: string) {
    if (next === credentialId) return;
    setCredentialId(next);
    setRepos([]);
    setSearch("");
    setStatus("loading");
  }

  function retry() {
    setStatus("loading");
    setReloadKey((n) => n + 1);
  }

  const filtered = search.trim()
    ? repos.filter((repo) =>
        repo.full_name.toLowerCase().includes(search.trim().toLowerCase()),
      )
    : repos;

  return (
    <div className="flex flex-col gap-3 py-2">
      {/* Zero credentials still needs the picker for its empty state; one
          credential is a control with nothing to choose. */}
      {usable.length !== 1 && (
        <CredentialPicker
          credentials={usable}
          value={credentialId || null}
          onChange={(next) => selectCredential(next ?? "")}
          disabled={disabled}
        />
      )}

      {status === "loading" && (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Asking GitHub…
        </div>
      )}

      {status === "error" && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={retry}
          disabled={disabled}
        >
          <RefreshCw />
          Try again
        </Button>
      )}

      {status === "loaded" && repos.length === 0 && (
        <p className="py-6 text-center text-xs text-muted-foreground">
          No repositories found for this account.
        </p>
      )}

      {status === "loaded" && repos.length > 0 && (
        <>
          <Input
            autoFocus
            value={search}
            placeholder="Filter repositories…"
            onChange={(event) => setSearch(event.target.value)}
          />
          <ScrollArea className="h-64 rounded-md border">
            <div className="flex flex-col p-1">
              {filtered.map((repo) => (
                <button
                  key={repo.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => onPick(repo, credentialId)}
                  className="flex items-start gap-2 rounded px-2 py-2 text-left hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
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
          {soleCredential && (
            <p className="text-[11px] text-muted-foreground">
              via {soleCredential.name}
            </p>
          )}
        </>
      )}
    </div>
  );
}
