"use client";

import { KeyRound } from "lucide-react";
import Link from "next/link";

import CredentialActionsMenu from "@/components/credentials/CredentialActionsMenu";
import ResourceCard, { type CardStatus } from "@/components/registry/ResourceCard";
import { Button } from "@/components/ui/button";
import {
  maskToken,
  PROVIDER_LABELS,
  type Credential,
} from "@/lib/credential-types";

/**
 * What a credential's last connection test found, as a dot and a phrase.
 *
 * Shared by the card and the table cell so a token cannot read "Verified" in
 * the grid and something else in the list. A token that expired months ago is
 * the thing this page exists to make visible without opening every row in turn.
 */
export function credentialStatus(credential: Credential): CardStatus {
  if (!credential.enabled) return { tone: "idle", label: "Disabled" };
  if (credential.lastValidationError) {
    return { tone: "error", label: `Last test failed: ${credential.lastValidationError}` };
  }
  if (credential.lastValidatedAt) {
    return { tone: "ok", label: `Verified as ${credential.username ?? "an account"}` };
  }
  return { tone: "warn", label: "Not tested yet" };
}

/** `GitHub · ••••1234` — the provider and enough of the token to tell two apart. */
export function credentialSubtitle(credential: Credential): string {
  return `${PROVIDER_LABELS[credential.provider]} · ${maskToken(credential.lastFour)}`;
}

/**
 * One personal credential in the grid.
 *
 * Composes ResourceCard rather than forking it — same reasoning as ProjectCard.
 * What it adds over the plain RegistryGrid card this page used before is the
 * actions menu, which is what makes the grid and the list offer the same things.
 */
export default function CredentialCard({
  credential,
  onDelete,
}: {
  credential: Credential;
  onDelete: (credential: Credential) => void;
}) {
  return (
    <ResourceCard
      icon={KeyRound}
      tone="green"
      title={credential.name}
      kind={credentialSubtitle(credential)}
      status={credentialStatus(credential)}
      disabled={!credential.enabled}
      actions={
        <CredentialActionsMenu credential={credential} onDelete={onDelete} />
      }
      meta={
        credential.scopes.length > 0 && (
          <span className="flex flex-wrap items-center gap-1.5">
            {credential.scopes.slice(0, 3).map((scope) => (
              <span
                key={scope}
                className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px]"
              >
                {scope}
              </span>
            ))}
            {credential.scopes.length > 3 && (
              <span className="text-[11px]">
                +{credential.scopes.length - 3} more
              </span>
            )}
          </span>
        )
      }
      action={
        <Button variant="outline" size="sm" className="w-full" asChild>
          <Link href={`/credentials/${credential.id}`}>Manage</Link>
        </Button>
      }
    />
  );
}
