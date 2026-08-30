"use client";

import { Braces, Lock } from "lucide-react";

import EnvVarActionsMenu from "@/components/credentials/EnvVarActionsMenu";
import ResourceCard, { type CardStatus } from "@/components/registry/ResourceCard";
import { displayValue, type ProjectEnvVar, type EnvVarListRow } from "@/lib/env-var-types";
import { relativeTime } from "@/lib/relative-time";

/** Secret or not, as a dot and a word. Shared by the card and the table cell. */
export function envVarStatus(envVar: ProjectEnvVar): CardStatus {
  return envVar.secret
    ? { tone: "ok", label: "Secret" }
    : { tone: "idle", label: "Plain text" };
}

/**
 * One environment variable in the grid.
 *
 * Composes ResourceCard, like ProjectCard and CredentialCard, so a variable
 * sits in the same shell as everything else in the app. The value goes on the
 * `kind` line, which is the mono one — a masked token and a plain hostname both
 * want a monospace face, and it is the line the card already truncates.
 *
 * An empty value renders as a marked-up "empty" rather than as nothing: a blank
 * card looks broken, and `KEY=` is a real thing to find in a `.env`.
 */
export default function EnvVarCard({
  envVar,
  onEdit,
  onDelete,
}: {
  envVar: EnvVarListRow;
  onEdit: (envVar: EnvVarListRow) => void;
  onDelete: (envVar: EnvVarListRow) => void;
}) {
  const value = displayValue(envVar);

  return (
    <ResourceCard
      icon={envVar.secret ? Lock : Braces}
      tone={envVar.secret ? "amber" : "blue"}
      title={envVar.key}
      kind={value === "" ? "(empty)" : value}
      status={envVarStatus(envVar)}
      actions={
        <EnvVarActionsMenu
          envVar={envVar}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      }
      meta={
        <span className="flex flex-col gap-1">
          {envVar.description && (
            <span className="line-clamp-2">{envVar.description}</span>
          )}
          <span title={new Date(envVar.updatedAt).toLocaleString()}>
            Updated {relativeTime(envVar.updatedAt)}
          </span>
        </span>
      }
    />
  );
}
