"use client";

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
import { toast } from "@/components/ui/toast";
import { envVarsApi } from "@/lib/env-var-api";
import { isValidEnvKey, type EnvVarListRow } from "@/lib/env-var-types";

/**
 * Edit one environment variable.
 *
 * The value field starts EMPTY for a secret and pre-filled for a plain one,
 * which is the whole difference the `secret` flag buys: the server never sent
 * a secret's plaintext, so there is nothing to pre-fill, and an empty box that
 * means "leave it alone" is the same contract CredentialEditor uses for a
 * token. For a plain variable the current value is right there to correct.
 *
 * That makes "" ambiguous for secrets only, so `touched` disambiguates: the
 * `value` field is sent when the operator typed in it, and omitted otherwise.
 * Without it, saving a rename on a secret would blank its value.
 */
export default function EditEnvVarDialog({
  envVar,
  onOpenChange,
}: {
  envVar: EnvVarListRow;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [key, setKey] = useState(envVar.key);
  const [value, setValue] = useState(envVar.secret ? "" : (envVar.value ?? ""));
  const [touched, setTouched] = useState(false);
  const [secret, setSecret] = useState(envVar.secret);
  const [description, setDescription] = useState(envVar.description ?? "");
  const [busy, setBusy] = useState(false);

  const keyValid = isValidEnvKey(key);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!keyValid) {
      toast.warning("Use letters, digits and underscores.");
      return;
    }

    // Turning a secret into a plain variable with no new value would leave the
    // UI showing a value the operator never chose to reveal. Ask for it.
    if (envVar.secret && !secret && !touched) {
      toast.warning(
        "Re-enter the value to un-hide it — the stored one was never sent to this page.",
      );
      return;
    }

    setBusy(true);
    try {
      await envVarsApi.update(envVar.id, {
        key,
        secret,
        description: description.trim() || null,
        ...(touched ? { value } : {}),
      });
      setValue("");
      onOpenChange(false);
      toast.success(`${key} saved`);
      router.refresh();
    } catch (err) {
      toast.error({
        title: "Could not save the variable",
        description: (err as Error).message,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        {/* A real form, so Enter submits without a keydown handler. */}
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Edit variable</DialogTitle>
            <DialogDescription>
              On <span className="font-medium">{envVar.projectName}</span>.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3 py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="edit-env-key" className="text-xs font-medium">
                Name
              </Label>
              <Input
                id="edit-env-key"
                autoFocus
                value={key}
                className="font-mono text-xs"
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => setKey(event.target.value)}
                disabled={busy}
                aria-invalid={!keyValid}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="edit-env-value" className="text-xs font-medium">
                Value
              </Label>
              <Input
                id="edit-env-value"
                type={secret ? "password" : "text"}
                autoComplete="off"
                spellCheck={false}
                value={value}
                placeholder={
                  envVar.secret ? "Leave blank to keep the stored value" : ""
                }
                className="font-mono text-xs"
                onChange={(event) => {
                  setTouched(true);
                  setValue(event.target.value);
                }}
                disabled={busy}
              />
            </div>

            <label className="flex cursor-pointer items-start gap-2.5">
              <input
                type="checkbox"
                checked={secret}
                onChange={(event) => setSecret(event.target.checked)}
                disabled={busy}
                className="mt-0.5 size-4 accent-primary"
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-xs font-medium">Secret</span>
                <span className="text-[11px] text-muted-foreground">
                  Masked everywhere and never shown again.
                </span>
              </span>
            </label>

            <div className="flex flex-col gap-2">
              <Label htmlFor="edit-env-note" className="text-xs font-medium">
                Note
              </Label>
              <Input
                id="edit-env-note"
                value={description}
                placeholder="What is this for?"
                onChange={(event) => setDescription(event.target.value)}
                disabled={busy}
              />
            </div>
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
            <Button type="submit" disabled={busy || !keyValid}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
