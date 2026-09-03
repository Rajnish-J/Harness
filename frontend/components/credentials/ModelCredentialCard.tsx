"use client";

import { Boxes, MoreHorizontal, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import EditModelCredentialDialog from "@/components/credentials/EditModelCredentialDialog";
import ResourceCard, { type CardStatus } from "@/components/registry/ResourceCard";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toast";
import { modelCredentialsApi } from "@/lib/model-credential-api";
import {
  credentialLabel,
  maskKey,
  MODEL_PROVIDER_LABELS,
  type ModelCredential,
} from "@/lib/model-credential-types";

/**
 * What a key's last test found, as a dot and a phrase.
 *
 * Shared by the card and the table cell so a key cannot read "Working" in the
 * grid and something else in the list. This is the same verdict the chat's model
 * picker renders, which is the point of storing it: an expired key should be
 * visible in the composer without opening this page at all.
 */
export function modelCredentialStatus(credential: ModelCredential): CardStatus {
  if (!credential.enabled) return { tone: "idle", label: "Disabled" };
  if (credential.lastValidationError) {
    return { tone: "error", label: credential.lastValidationError };
  }
  if (credential.lastValidatedAt) {
    return { tone: "ok", label: "Key accepted" };
  }
  return { tone: "warn", label: "Not tested yet" };
}

/** `Groq · ••••4f2a` — the provider and enough of the key to tell two apart. */
export function modelCredentialSubtitle(credential: ModelCredential): string {
  return `${MODEL_PROVIDER_LABELS[credential.provider]} · ${maskKey(credential.lastFour)}`;
}

/**
 * One registered provider key in the grid.
 *
 * Test is the primary action rather than a menu item, unlike the PAT card's
 * Manage. A model key has one question worth asking — does it still work — and
 * the answer decides whether the chat's model picker offers this provider at
 * all, so it is worth one click rather than two.
 */
export default function ModelCredentialCard({
  credential,
  onDelete,
}: {
  credential: ModelCredential;
  onDelete: (credential: ModelCredential) => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [, startTransition] = useTransition();

  async function test() {
    setTesting(true);
    try {
      const result = await modelCredentialsApi.test(credential.id);
      if (result.ok) toast.success(result.message);
      else toast.error({ title: "Key rejected", description: result.message });
      // Refresh so the stored verdict re-renders here and the chat picker picks
      // it up on its next fetch.
      startTransition(() => router.refresh());
    } catch (err) {
      toast.error({
        title: "Could not test the key",
        description: (err as Error).message,
      });
    } finally {
      setTesting(false);
    }
  }

  const extras = credential.extraModels;

  return (
    <>
      <ResourceCard
        icon={Boxes}
        tone="purple"
        title={credentialLabel(credential)}
        kind={modelCredentialSubtitle(credential)}
        status={modelCredentialStatus(credential)}
        disabled={!credential.enabled}
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground"
              >
                <MoreHorizontal />
                <span className="sr-only">
                  Actions for {credentialLabel(credential)}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onSelect={() => setEditing(true)}>
                Replace key…
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => onDelete(credential)}
              >
                <Trash2 />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
        meta={
          extras.length > 0 && (
            <span className="flex flex-wrap items-center gap-1.5">
              {extras.slice(0, 3).map((model) => (
                <span
                  key={model}
                  className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px]"
                >
                  {model}
                </span>
              ))}
              {extras.length > 3 && (
                <span className="text-[11px]">+{extras.length - 3} more</span>
              )}
            </span>
          )
        }
        action={
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={test}
            disabled={testing}
          >
            {testing ? "Testing…" : "Test key"}
          </Button>
        }
      />

      {editing && (
        <EditModelCredentialDialog
          key={credential.id}
          credential={credential}
          onOpenChange={(open) => {
            if (!open) setEditing(false);
          }}
        />
      )}
    </>
  );
}
