"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "@/components/ui/toast";
import { credentialsApi } from "@/lib/credential-api";
import type { Credential } from "@/lib/credential-types";

/**
 * Delete one or more personal credentials.
 *
 * No type-the-name confirmation, unlike DeleteProjectDialog. Deleting a
 * credential destroys a token you can mint again in a minute; deleting a
 * project destroys a working tree you cannot. `projects.credential_id` is
 * ON DELETE SET NULL, so the projects using this one keep working — they simply
 * cannot sync until another credential is linked, which is what the warning
 * below says.
 */
export default function DeleteCredentialDialog({
  credentials,
  onOpenChange,
  onDeleted,
}: {
  /** Never empty — the explorer mounts this only when there is something to
   *  delete, under a key derived from the ids. */
  credentials: Credential[];
  onOpenChange: (open: boolean) => void;
  /** Fired after a successful delete — lets the table drop its selection. */
  onDeleted?: () => void;
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  const single = credentials.length === 1 ? credentials[0] : null;

  async function remove() {
    setDeleting(true);

    const failures: string[] = [];
    for (const credential of credentials) {
      try {
        await credentialsApi.remove(credential.id);
      } catch (error) {
        failures.push(`${credential.name}: ${(error as Error).message}`);
      }
    }

    const deleted = credentials.length - failures.length;
    if (deleted > 0) {
      toast.success(
        single ? `Deleted “${single.name}”.` : `Deleted ${deleted} credentials.`,
      );
    }
    if (failures.length > 0) {
      toast.error({
        title:
          failures.length === credentials.length
            ? "Could not delete the credential"
            : `Could not delete ${failures.length} of ${credentials.length}`,
        description: failures.join(" · "),
      });
    }

    setDeleting(false);
    onOpenChange(false);
    onDeleted?.();
    router.refresh();
  }

  return (
    <AlertDialog open onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {single
              ? `Delete “${single.name}”?`
              : `Delete ${credentials.length} credentials?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            The stored token is destroyed. Any project linked to
            {single ? " it" : " one of them"} keeps its code and its history, but
            cannot pull, push or open a pull request until another credential is
            linked. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={deleting}
            onClick={(event) => {
              // Radix closes on Action by default; the close has to wait for the
              // round trips, so the dialog drives it in `remove`.
              event.preventDefault();
              void remove();
            }}
            className="bg-destructive text-white hover:bg-destructive/90"
          >
            {deleting ? "Deleting…" : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
