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
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { modelCredentialsApi } from "@/lib/model-credential-api";
import {
  maskKey,
  MODEL_PROVIDER_LABELS,
  type ModelCredential,
} from "@/lib/model-credential-types";

/**
 * Edit one provider key: replace the secret, rename it, add custom model ids,
 * turn it off.
 *
 * The secret field starts empty and an empty submit leaves the stored key
 * alone — the API contract, not a UI convention: PATCH treats an absent
 * `secret` as "keep" and rejects a present-but-empty one outright. There is no
 * reveal, because nothing on the server can serve the plaintext back.
 *
 * Custom model ids are edited as a comma/newline separated list rather than with
 * a repeater. They are pasted from a provider's docs far more often than they
 * are typed one at a time.
 */
export default function EditModelCredentialDialog({
  credential,
  onOpenChange,
}: {
  credential: ModelCredential;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [secret, setSecret] = useState("");
  const [label, setLabel] = useState(credential.label ?? "");
  const [baseUrl, setBaseUrl] = useState(credential.baseUrl ?? "");
  const [extraModels, setExtraModels] = useState(
    credential.extraModels.join(", "),
  );
  const [enabled, setEnabled] = useState(credential.enabled);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);

    const parsedExtras = extraModels
      .split(/[,\n]/)
      .map((value) => value.trim())
      .filter(Boolean);

    try {
      await modelCredentialsApi.update(credential.id, {
        label: label.trim() || null,
        baseUrl: baseUrl.trim() || null,
        extraModels: parsedExtras,
        enabled,
        // Omitted entirely when blank: sending "" would be rejected as an
        // attempt to store an empty key.
        ...(secret.trim() ? { secret: secret.trim() } : {}),
      });
      setSecret("");
      onOpenChange(false);
      toast.success(
        `${MODEL_PROVIDER_LABELS[credential.provider]} key updated`,
      );
      router.refresh();
    } catch (err) {
      toast.error({
        title: "Could not save",
        description: (err as Error).message,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>
              {MODEL_PROVIDER_LABELS[credential.provider]} key
            </DialogTitle>
            <DialogDescription>
              Currently {maskKey(credential.lastFour)}. Leave the key field empty
              to keep it.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3 py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="edit-secret" className="text-xs font-medium">
                Replace key
              </Label>
              <Input
                id="edit-secret"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={secret}
                placeholder="Leave empty to keep the current key"
                className="font-mono text-xs"
                onChange={(event) => setSecret(event.target.value)}
                disabled={busy}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="edit-label" className="text-xs font-medium">
                Label <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="edit-label"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                disabled={busy}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="edit-extra" className="text-xs font-medium">
                Extra model ids{" "}
                <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="edit-extra"
                value={extraModels}
                placeholder="qwen/qwen3-32b, gemma2-9b-it"
                className="font-mono text-xs"
                onChange={(event) => setExtraModels(event.target.value)}
                disabled={busy}
              />
              <p className="text-[11px] text-muted-foreground">
                Models this key can reach that the harness does not list. They
                appear in the chat picker with no description or pricing.
              </p>
              {/* What the provider itself reported on the last test. The whole
                  reason to store it: this is the list you are picking from when
                  you fill in the field above, and hunting for it in the
                  provider's docs is the tedious part of adding a model. */}
              {credential.validatedModels.length > 0 && (
                <details className="text-[11px] text-muted-foreground">
                  <summary className="cursor-pointer select-none underline-offset-2 hover:underline">
                    {credential.validatedModels.length} models this key reported
                  </summary>
                  <div className="mt-1.5 flex max-h-32 flex-wrap gap-1 overflow-y-auto">
                    {credential.validatedModels.map((model) => (
                      <button
                        key={model}
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          setExtraModels((current) =>
                            current
                              .split(/[,\n]/)
                              .map((value) => value.trim())
                              .filter(Boolean)
                              .includes(model)
                              ? current
                              : [current.trim(), model]
                                  .filter(Boolean)
                                  .join(", "),
                          )
                        }
                        className="rounded-md bg-muted px-1.5 py-0.5 font-mono transition-colors hover:bg-accent"
                      >
                        {model}
                      </button>
                    ))}
                  </div>
                </details>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="edit-base-url" className="text-xs font-medium">
                Base URL{" "}
                <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="edit-base-url"
                value={baseUrl}
                placeholder="Leave empty for the provider's own endpoint"
                className="font-mono text-xs"
                onChange={(event) => setBaseUrl(event.target.value)}
                disabled={busy}
              />
            </div>

            <label className="flex items-center justify-between gap-3 pt-1">
              <span className="text-xs font-medium">Enabled</span>
              <Switch
                checked={enabled}
                onCheckedChange={setEnabled}
                disabled={busy}
              />
            </label>
            <p className="-mt-1 text-[11px] text-muted-foreground">
              Turning this off hides the provider&apos;s models from the chat
              without deleting the key.
            </p>
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
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
