"use client";

import { Plus } from "lucide-react";
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
import { credentialsApi } from "@/lib/credential-api";
import {
  CREDENTIAL_PROVIDERS,
  PROVIDER_LABELS,
  type CredentialProvider,
} from "@/lib/credential-types";

/**
 * "New credential".
 *
 * Deliberately NOT built on NewRecordButton, which collects only a name and
 * creates an empty record for the editor to fill in. That flow cannot work here:
 * a credential with no token is not a credential, and because the editor can
 * never display a stored secret, a half-created one would be indistinguishable
 * from a complete one. So the token is required up front, and the row is only
 * ever written complete.
 */
export default function NewCredentialButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [provider, setProvider] = useState<CredentialProvider>("github");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset through the open handler rather than an effect: this is an event, and
  // setState inside useEffect is a lint error in this repo.
  function onOpenChange(next: boolean) {
    if (busy) return;
    setOpen(next);
    if (next) {
      setName("");
      setProvider("github");
      setSecret("");
      setError(null);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmedName = name.trim();
    const trimmedSecret = secret.trim();
    if (!trimmedName) {
      setError("Give it a name first.");
      return;
    }
    if (!trimmedSecret) {
      setError("Paste the token — a credential without one is not usable.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const created = await credentialsApi.create({
        name: trimmedName,
        provider,
        secret: trimmedSecret,
      });
      // Clear the token from component state the moment it is no longer needed.
      setSecret("");
      router.push(`/credentials/${created.id}`);
      setOpen(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button type="button" size="sm" onClick={() => onOpenChange(true)}>
        <Plus />
        New credential
      </Button>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          {/* A real form, so Enter submits without a keydown handler. */}
          <form onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>New credential</DialogTitle>
              <DialogDescription>
                A personal access token. It is encrypted before it is stored and
                is never shown again — only replaced.
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-3 py-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="credential-name" className="text-xs font-medium">
                  Name
                </Label>
                <Input
                  id="credential-name"
                  autoFocus
                  value={name}
                  placeholder="My GitHub PAT"
                  onChange={(event) => setName(event.target.value)}
                  disabled={busy}
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label className="text-xs font-medium">Provider</Label>
                <div className="flex flex-wrap gap-2">
                  {CREDENTIAL_PROVIDERS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      disabled={busy}
                      onClick={() => setProvider(option)}
                      className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
                        provider === option
                          ? "border-primary bg-primary text-primary-foreground"
                          : "hover:bg-accent"
                      }`}
                    >
                      {PROVIDER_LABELS[option]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="credential-secret" className="text-xs font-medium">
                  Token
                </Label>
                <Input
                  id="credential-secret"
                  // type=password so it is not shoulder-readable and browsers do
                  // not offer to remember it as ordinary text.
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={secret}
                  placeholder="ghp_…"
                  className="font-mono text-xs"
                  onChange={(event) => setSecret(event.target.value)}
                  disabled={busy}
                />
                <p className="text-[11px] text-muted-foreground">
                  Needs <span className="font-mono">repo</span> scope to clone
                  private repositories and open pull requests.
                </p>
              </div>

              {error && (
                <p className="text-xs text-destructive" role="alert">
                  {error}
                </p>
              )}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={busy || !name.trim() || !secret.trim()}>
                {busy ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
