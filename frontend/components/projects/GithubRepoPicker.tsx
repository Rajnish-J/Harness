"use client";

import { GitBranch, Loader2, Lock, Search } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Credential } from "@/lib/credential-types";
import { projectsApi } from "@/lib/project-api";
import type { RemoteRepo } from "@/lib/project-types";

/**
 * Pick a credential, then a repository it can see.
 *
 * Shared by NewProjectDialog's "Import from GitHub" step and
 * ConnectGithubDialog: both need the exact same "which account, which repo"
 * choice, just followed by a different action once one is picked.
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
  const usable = credentials.filter((credential) => credential.enabled);
  const [credentialId, setCredentialId] = useState<string>(usable[0]?.id ?? "");
  const [repos, setRepos] = useState<RemoteRepo[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadRepos(id: string) {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      setRepos(await projectsApi.listRemoteRepos(id));
    } catch (err) {
      setError((err as Error).message);
      setRepos([]);
    } finally {
      setLoading(false);
    }
  }

  function chooseCredential(id: string) {
    setCredentialId(id);
    setRepos([]);
    void loadRepos(id);
  }

  if (usable.length === 0) {
    return (
      <div className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
        No enabled credentials. Add a GitHub token on the Credentials page first.
      </div>
    );
  }

  const filtered = search.trim()
    ? repos.filter((repo) =>
        repo.full_name.toLowerCase().includes(search.trim().toLowerCase()),
      )
    : repos;

  return (
    <div className="flex flex-col gap-3 py-2">
      <div className="flex flex-col gap-2">
        <Label className="text-xs font-medium">Credential</Label>
        <div className="flex flex-wrap gap-2">
          {usable.map((credential) => (
            <button
              key={credential.id}
              type="button"
              disabled={disabled}
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

      {repos.length === 0 && !loading && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => loadRepos(credentialId)}
          disabled={!credentialId || disabled}
        >
          <Search />
          Load repositories
        </Button>
      )}

      {loading && (
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
        </>
      )}

      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
