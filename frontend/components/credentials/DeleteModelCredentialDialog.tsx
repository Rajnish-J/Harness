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
import { modelCredentialsApi } from "@/lib/model-credential-api";
import {
  credentialLabel,
  MODEL_PROVIDER_LABELS,
  type ModelCredential,
} from "@/lib/model-credential-types";

/**
 * Delete one or more provider keys.
 *
 * No type-the-name confirmation, for the reason DeleteCredentialDialog gives:
 * this destroys a key you can mint again in a minute. The consequence worth
 * spelling out is the one the operator will notice next — the provider's models
 * disappear from the chat's model picker the moment this lands.
 */
export default function DeleteModelCredentialDialog({
  credentials,
  onOpenChange,
  onDeleted,
}: {
  /** Never empty — the explorer mounts this only when there is something to
   *  delete, under a key derived from the ids. */
  credentials: ModelCredential[];
  onOpenChange: (open: boolean) => void;
  /** Fired after a successful delete — lets the table drop its selection. */
  onDeleted?: () => void;
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  const single = credentials.length === 1 ? credentials[0] : null;
  const providers = credentials
    .map((row) => MODEL_PROVIDER_LABELS[row.provider])
    .join(", ");

  async function remove() {
    setDeleting(true);

    const failures: string[] = [];
    for (const credential of credentials) {
      try {
        await modelCredentialsApi.remove(credential.id);
      } catch (error) {
        failures.push(`${credentialLabel(credential)}: ${(error as Error).message}`);
      }
    }

    const deleted = credentials.length - failures.length;
    if (deleted > 0) {
      toast.success(
        single
          ? `Deleted the ${MODEL_PROVIDER_LABELS[single.provider]} key.`
          : `Deleted ${deleted} keys.`,
      );
    }
    if (failures.length > 0) {
      toast.error({
        title:
          failures.length === credentials.length
            ? "Could not delete the key"
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
              ? `Delete the ${MODEL_PROVIDER_LABELS[single.provider]} key?`
              : `Delete ${credentials.length} provider keys?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            The stored key is destroyed, and {providers}
            {single ? "'s" : ""} models stop being selectable in the chat
            immediately. Any conversation already running on{" "}
            {single ? "it" : "one of them"} will fail its next turn. This cannot
            be undone.
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
