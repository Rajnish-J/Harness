"use client";

import {
  ArrowLeft,
  Check,
  ExternalLink,
  KeyRound,
  Loader2,
  Plug,
  ShieldCheck,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import CredentialPicker from "@/components/projects/CredentialPicker";
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
import { toast } from "@/components/ui/toast";
import { credentialsApi } from "@/lib/credential-api";
import type { Credential, CredentialTestResult } from "@/lib/credential-types";
import type { CatalogEntry } from "@/lib/mcp-catalog";
import { mcpApi } from "@/lib/registry-api";

/**
 * Add a catalog server, walking the operator through the token it needs.
 *
 * ## Why a wizard and not a form
 *
 * The connection details are already known — that is what makes it a catalog
 * entry. The only thing the harness cannot supply is the token, and getting a
 * PAT right is genuinely fiddly: it has to be created on another site, scoped
 * correctly, and it fails silently later if it is not. So the steps are the
 * parts a person actually has to do, and each one is verified before the next
 * is offered.
 *
 * ## Where the token goes
 *
 * Into the encrypted `credentials` vault, never into `mcp_servers`. The server
 * row stores only `credentialId`, and Python decrypts at connect time (see
 * backend/app/mcp/credentials.py). That is why "reuse an existing credential"
 * is offered first: one PAT can serve both this and the GitHub project actions,
 * and a second copy of the same token is a second thing to rotate.
 */
type Step = "token" | "test";

export default function CatalogWizard({
  entry,
  open,
  onOpenChange,
}: {
  entry: CatalogEntry;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("token");
  const [busy, setBusy] = useState(false);

  const [credentials, setCredentials] = useState<Credential[] | null>(null);
  const [credentialId, setCredentialId] = useState<string | null>(null);
  // Flipped once the credential list arrives and turns out to be empty.
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState(`${entry.title} PAT`);
  const [secret, setSecret] = useState("");
  const [result, setResult] = useState<CredentialTestResult | null>(null);

  // Load once per mount. The caller mounts this only while adding, so there is
  // no stale-state problem to reset for: closing unmounts, reopening remounts.
  useEffect(() => {
    let cancelled = false;

    credentialsApi
      .list()
      .then((all) => {
        if (cancelled) return;
        const usable = all.filter(
          (c) => c.provider === entry.auth.provider && c.enabled,
        );
        setCredentials(usable);
        // Nothing to reuse means the only path is creating one; skip the choice.
        setCreating(usable.length === 0);
      })
      .catch(() => {
        if (cancelled) return;
        setCredentials([]);
        setCreating(true);
      });

    return () => {
      cancelled = true;
    };
  }, [entry]);

  async function submitToken() {
    setBusy(true);
    try {
      let id = credentialId;

      if (creating) {
        const created = await credentialsApi.create({
          name: name.trim(),
          provider: entry.auth.provider,
          secret: secret.trim(),
        });
        id = created.id;
        setCredentialId(id);
      }

      if (!id) {
        toast.warning("Pick a credential first.");
        return;
      }

      // Test before creating the server. A PAT that does not work produces an
      // MCP server that connects to nothing, and the failure would surface
      // three screens later as an unavailable-server notice in chat.
      const verdict = await credentialsApi.test(id);
      setResult(verdict);
      setStep("test");
    } catch (error) {
      toast.error({
        title: "Could not save that token",
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  }

  async function createServer() {
    setBusy(true);
    try {
      const server = await mcpApi.create({
        name: entry.name,
        description: entry.description,
        transport: entry.transport,
        url: entry.url,
        credentialId,
        enabled: true,
      });
      toast.success(`${entry.title} added`);
      onOpenChange(false);
      router.push(`/mcp/${server.id}`);
      router.refresh();
    } catch (error) {
      toast.error({
        title: `Could not add ${entry.title}`,
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  }

  const canSubmitToken = creating
    ? Boolean(name.trim() && secret.trim())
    : Boolean(credentialId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plug className="size-4" />
            Add {entry.title}
          </DialogTitle>
          <DialogDescription>{entry.description}</DialogDescription>
        </DialogHeader>

        {step === "token" && (
          <div className="flex flex-col gap-5 py-2">
            <ul className="flex flex-col gap-1.5 text-sm text-muted-foreground">
              {entry.summary.map((line) => (
                <li key={line} className="flex items-start gap-2">
                  <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-500" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>

            <div className="rounded-lg border bg-muted/30 p-3 text-sm">
              <div className="flex items-center gap-2 font-medium">
                <KeyRound className="size-3.5" />
                You need a personal access token
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                It is stored encrypted, and only ever sent to {entry.title}.
                Give it these scopes:
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {entry.auth.scopes.map((scope) => (
                  <code
                    key={scope}
                    className="rounded border bg-background px-1.5 py-0.5 font-mono text-xs"
                  >
                    {scope}
                  </code>
                ))}
              </div>
              <a
                href={entry.auth.tokenUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-2.5 inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
              >
                Create one on {entry.title}
                <ExternalLink className="size-3" />
              </a>
            </div>

            {!creating && credentials && credentials.length > 0 && (
              <div className="flex flex-col gap-2">
                <CredentialPicker
                  credentials={credentials}
                  value={credentialId}
                  onChange={setCredentialId}
                  label="Use a saved token"
                />
                <button
                  type="button"
                  onClick={() => setCreating(true)}
                  className="self-start text-xs text-muted-foreground hover:underline"
                >
                  Or add a new one
                </button>
              </div>
            )}

            {creating && (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="cred-name" className="text-xs font-medium">
                    Name
                  </Label>
                  <Input
                    id="cred-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={`${entry.title} PAT`}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="cred-secret" className="text-xs font-medium">
                    Token
                  </Label>
                  <Input
                    id="cred-secret"
                    type="password"
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                    placeholder="ghp_…"
                    autoComplete="off"
                  />
                  <p className="text-xs text-muted-foreground">
                    Encrypted before it reaches the database. It is never shown
                    again — you can replace it, but not read it back.
                  </p>
                </div>
                {credentials && credentials.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setCreating(false)}
                    className="self-start text-xs text-muted-foreground hover:underline"
                  >
                    Use a saved token instead
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {step === "test" && result && (
          <div className="flex flex-col gap-4 py-2">
            <div
              className={`flex items-start gap-3 rounded-lg border p-3 ${
                result.ok
                  ? "border-emerald-500/30 bg-emerald-500/5"
                  : "border-red-500/30 bg-red-500/5"
              }`}
            >
              {result.ok ? (
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-500" />
              ) : (
                <X className="mt-0.5 size-4 shrink-0 text-red-500" />
              )}
              <div className="flex flex-col gap-1 text-sm">
                <span className="font-medium">
                  {result.ok ? "Token works" : "Token rejected"}
                </span>
                <span className="text-xs text-muted-foreground">
                  {result.message}
                </span>
                {result.username && (
                  <span className="text-xs text-muted-foreground">
                    Authenticated as{" "}
                    <span className="font-mono">{result.username}</span>
                  </span>
                )}
                {result.scopes.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {result.scopes.map((scope) => (
                      <code
                        key={scope}
                        className="rounded border bg-background px-1.5 py-0.5 font-mono text-xs"
                      >
                        {scope}
                      </code>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {result.ok && (
              <p className="text-xs text-muted-foreground">
                {entry.title} will be added as an {entry.transport} server at{" "}
                <span className="font-mono">{entry.url}</span>, using this token.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          {step === "test" && (
            <Button
              variant="ghost"
              onClick={() => setStep("token")}
              disabled={busy}
              className="mr-auto"
            >
              <ArrowLeft className="size-4" />
              Back
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          {step === "token" && (
            <Button onClick={submitToken} disabled={busy || !canSubmitToken}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              Test connection
            </Button>
          )}
          {step === "test" && (
            <Button onClick={createServer} disabled={busy || !result?.ok}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              Add {entry.title}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
