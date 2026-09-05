"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useChatPreset } from "@/components/chat/ChatPresetProvider";
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
import { modelCredentialsApi } from "@/lib/model-credential-api";
import {
  MODEL_PROVIDERS,
  MODEL_PROVIDER_CONSOLES,
  MODEL_PROVIDER_KEY_PREFIXES,
  MODEL_PROVIDER_LABELS,
  type ModelProvider,
} from "@/lib/model-credential-types";

/**
 * "Add provider key".
 *
 * The key is required up front for the reason NewCredentialButton gives: the UI
 * can never display a stored secret, so a half-created row would be
 * indistinguishable from a complete one.
 *
 * The provider is free text (matched case/whitespace-insensitively against the
 * three supported providers) rather than a preset picker. The table is UNIQUE
 * on provider, so typing an already-registered one is caught before the round
 * trip — it would otherwise only surface as a 409.
 */
export default function NewModelCredentialDialog({
  takenProviders,
}: {
  takenProviders: ModelProvider[];
}) {
  const router = useRouter();
  const { refetchModels } = useChatPreset();
  const [open, setOpen] = useState(false);
  const [providerText, setProviderText] = useState("");
  const [secret, setSecret] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);

  const available = MODEL_PROVIDERS.filter((p) => !takenProviders.includes(p));

  // Reset through the open handler rather than an effect: this is an event, and
  // setState inside useEffect is a lint error in this repo.
  function onOpenChange(next: boolean) {
    if (busy) return;
    setOpen(next);
    if (next) {
      setProviderText("");
      setSecret("");
      setLabel("");
    }
  }

  // Typed text is matched against the enum case/whitespace-insensitively — the
  // DB column is a lowercase Postgres enum, so this is the only normalization
  // that happens; the input never shows or stores the raw casing.
  const normalized = providerText.trim().toLowerCase();
  const matchedProvider: ModelProvider | null =
    MODEL_PROVIDERS.find((p) => p === normalized) ?? null;

  const prefix = matchedProvider ? MODEL_PROVIDER_KEY_PREFIXES[matchedProvider] : null;
  const trimmed = secret.trim();
  // A warning, not a block: providers change key formats and being wrong about
  // one should not stop someone registering a key that actually works.
  const prefixLooksOff = Boolean(prefix && trimmed && !trimmed.startsWith(prefix));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!normalized) {
      toast.warning("Type a provider first.");
      return;
    }
    if (!matchedProvider) {
      toast.warning(
        `Unsupported provider. Use one of: ${MODEL_PROVIDERS.map((p) => MODEL_PROVIDER_LABELS[p]).join(", ")}.`,
      );
      return;
    }
    if (takenProviders.includes(matchedProvider)) {
      toast.warning(`${MODEL_PROVIDER_LABELS[matchedProvider]} is already registered.`);
      return;
    }
    if (!trimmed) {
      toast.warning("Paste the API key — a credential without one is not usable.");
      return;
    }

    setBusy(true);
    try {
      const created = await modelCredentialsApi.create({
        provider: matchedProvider,
        label: label.trim() || null,
        secret: trimmed,
      });
      // Clear the key from component state the moment it is no longer needed.
      setSecret("");
      setOpen(false);
      toast.success(`${MODEL_PROVIDER_LABELS[matchedProvider]} key saved`);

      // Test immediately. The verdict is what the chat's model picker renders,
      // so a key that lands "untested" would show as a warning the operator
      // never asked for and has to clear by hand.
      try {
        const result = await modelCredentialsApi.test(created.id);
        if (!result.ok) {
          toast.error({ title: "Key was rejected", description: result.message });
        }
      } catch {
        // The key is saved; a failed check is not a failed save.
      }
      // The chat catalog is fetched once on load, so without this the picker
      // would only see this key after a full page reload.
      void refetchModels();
      router.refresh();
    } catch (err) {
      toast.error({
        title: "Could not save the key",
        description: (err as Error).message,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        onClick={() => onOpenChange(true)}
        disabled={available.length === 0}
      >
        <Plus />
        Add provider key
      </Button>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          {/* A real form, so Enter submits without a keydown handler. */}
          <form onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>Add provider key</DialogTitle>
              <DialogDescription>
                An LLM provider API key. It is encrypted before it is stored and
                is never shown again — only replaced. Registering one makes that
                provider&apos;s models selectable in the chat.
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-3 py-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="model-credential-provider" className="text-xs font-medium">
                  Provider
                </Label>
                <Input
                  id="model-credential-provider"
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                  value={providerText}
                  placeholder="anthropic, openai, groq…"
                  onChange={(event) => setProviderText(event.target.value)}
                  disabled={busy}
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="model-credential-secret" className="text-xs font-medium">
                  API key
                </Label>
                <Input
                  id="model-credential-secret"
                  // type=password so it is not shoulder-readable and browsers do
                  // not offer to remember it as ordinary text.
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={secret}
                  placeholder={prefix ? `${prefix}…` : "gsk_…"}
                  className="font-mono text-xs"
                  onChange={(event) => setSecret(event.target.value)}
                  disabled={busy}
                />
                {prefixLooksOff ? (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400">
                    {MODEL_PROVIDER_LABELS[matchedProvider!]} keys usually start with{" "}
                    <span className="font-mono">{prefix}</span>. Saving anyway is
                    fine — the test will tell you for certain.
                  </p>
                ) : (
                  matchedProvider && (
                    <p className="text-[11px] text-muted-foreground">
                      Get one from{" "}
                      <a
                        href={MODEL_PROVIDER_CONSOLES[matchedProvider]}
                        target="_blank"
                        rel="noreferrer"
                        className="underline underline-offset-2"
                      >
                        {MODEL_PROVIDER_LABELS[matchedProvider]}&apos;s console
                      </a>
                      .
                    </p>
                  )
                )}
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="model-credential-label" className="text-xs font-medium">
                  Label <span className="text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  id="model-credential-label"
                  value={label}
                  placeholder={
                    matchedProvider ? `${MODEL_PROVIDER_LABELS[matchedProvider]} (personal)` : ""
                  }
                  onChange={(event) => setLabel(event.target.value)}
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
              <Button type="submit" disabled={busy || !matchedProvider || !trimmed}>
                {busy ? "Saving…" : "Save and test"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
