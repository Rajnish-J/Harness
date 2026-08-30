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
import { envVarsApi } from "@/lib/env-var-api";
import type { EnvVarListRow } from "@/lib/env-var-types";

/**
 * Delete one or more environment variables.
 *
 * A secret deleted here is unrecoverable — this app never had the plaintext to
 * give back, and neither does the operator unless they kept the original. The
 * copy says so plainly rather than leaning on a generic "cannot be undone".
 */
export default function DeleteEnvVarDialog({
  envVars,
  onOpenChange,
  onDeleted,
}: {
  /** Never empty — the explorer mounts this only when there is something to
   *  delete, under a key derived from the ids. */
  envVars: EnvVarListRow[];
  onOpenChange: (open: boolean) => void;
  /** Fired after a successful delete — lets the table drop its selection. */
  onDeleted?: () => void;
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  const single = envVars.length === 1 ? envVars[0] : null;
  const anySecret = envVars.some((envVar) => envVar.secret);

  async function remove() {
    setDeleting(true);

    const failures: string[] = [];
    for (const envVar of envVars) {
      try {
        await envVarsApi.remove(envVar.id);
      } catch (error) {
        failures.push(`${envVar.key}: ${(error as Error).message}`);
      }
    }

    const deleted = envVars.length - failures.length;
    if (deleted > 0) {
      toast.success(
        single
          ? `Deleted ${single.key}.`
          : `Deleted ${deleted} variables.`,
      );
    }
    if (failures.length > 0) {
      toast.error({
        title:
          failures.length === envVars.length
            ? "Could not delete the variable"
            : `Could not delete ${failures.length} of ${envVars.length}`,
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
              ? `Delete ${single.key}?`
              : `Delete ${envVars.length} variables?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {single
              ? `Removes it from ${single.projectName}.`
              : "Removes them from their projects."}{" "}
            {anySecret
              ? "The stored value is destroyed, and this app never held a copy it could show you — if you do not have the original elsewhere, it is gone."
              : "This cannot be undone."}
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
