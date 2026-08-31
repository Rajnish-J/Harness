"use client";

import { Check, Copy } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import { copyText } from "@/lib/clipboard";
import { projectsApi } from "@/lib/project-api";
import type { ProjectListRow } from "@/lib/project-types";

/**
 * Delete one or more projects, and reclaim what they were using.
 *
 * Two calls against two servers per project, in this order:
 *
 *   1. `DELETE /api/projects/{id}`  — Next.js archives the row.
 *   2. `POST   .../purge`           — Python removes the container, clears the
 *                                     file index, and deletes the checkout.
 *
 * The order is not arbitrary. Archiving is the outcome the operator actually
 * asked for, and it is the half that always succeeds; purging touches a Docker
 * daemon that may not be running and a directory Windows may have locked. Doing
 * it this way means a purge failure degrades to "the row is gone, the files are
 * still there" — the behaviour this app shipped with for months — instead of
 * stranding a visible project whose working tree has been deleted underneath it.
 *
 * A failed purge is therefore a warning, not an error. The project *is* gone.
 */
export default function DeleteProjectDialog({
  projects,
  onOpenChange,
  onDeleted,
}: {
  /** The projects to delete. Never empty — ProjectsExplorer mounts this only
   *  when there is something to delete, under a key derived from the ids, so a
   *  different selection remounts with a cleared confirmation box. */
  projects: ProjectListRow[];
  onOpenChange: (open: boolean) => void;
  /** Fired after a successful delete — lets the table drop its selection. */
  onDeleted?: () => void;
}) {
  const router = useRouter();
  const [confirmation, setConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The dialog unmounts as soon as the delete lands, which can be well inside
  // the two seconds the tick is meant to stay up.
  useEffect(() => () => {
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
  }, []);

  const single = projects.length === 1 ? projects[0] : null;
  // Typing the name is only meaningful for one project. For a multi-select the
  // count is the thing worth confirming, and "type all six names" is theatre.
  const expected = single ? single.name : `delete ${projects.length}`;
  const confirmed = confirmation.trim() === expected;

  async function copyExpected() {
    if (!(await copyText(expected))) {
      toast.error({
        title: "Could not copy the name",
        description: "The clipboard is only available over HTTPS or on localhost.",
      });
      return;
    }
    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 2000);
  }

  async function remove() {
    if (!confirmed) return;
    setDeleting(true);

    const failures: string[] = [];
    const notReclaimed: string[] = [];

    for (const project of projects) {
      try {
        await projectsApi.remove(project.id);
      } catch (error) {
        failures.push(`${project.name}: ${(error as Error).message}`);
        continue;
      }

      // The row is already gone from the operator's point of view, so nothing
      // below is allowed to throw out of this loop.
      try {
        const result = await projectsApi.purge(project.id);
        if (!result.workspace_removed) {
          notReclaimed.push(`${project.name}: ${result.message}`);
        }
      } catch (error) {
        notReclaimed.push(`${project.name}: ${(error as Error).message}`);
      }
    }

    const deleted = projects.length - failures.length;

    if (deleted > 0) {
      const what = single ? `“${single.name}”` : `${deleted} projects`;
      if (notReclaimed.length > 0) {
        toast.warning({
          title: `Deleted ${what}, but the files could not be removed`,
          description: notReclaimed.join(" · "),
          duration: Infinity,
        });
      } else {
        toast.success(`Deleted ${what} and reclaimed the files on disk.`);
      }
    }

    if (failures.length > 0) {
      toast.error({
        title:
          failures.length === projects.length
            ? "Could not delete the project"
            : `Could not delete ${failures.length} of ${projects.length} projects`,
        description: failures.join(" · "),
      });
    }

    setDeleting(false);
    onOpenChange(false);
    onDeleted?.();
    router.refresh();
  }

  const totalFiles = projects.reduce((sum, p) => sum + p.fileCount, 0);

  return (
    <AlertDialog open onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {single ? `Delete “${single.name}”?` : `Delete ${projects.length} projects?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            This removes the project from the harness and deletes its checkout
            from disk
            {totalFiles > 0 && `, including ${totalFiles.toLocaleString()} indexed files`}
            . Anything committed and pushed stays on the remote; anything only
            on this machine does not. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Label htmlFor="delete-confirm" className="text-xs font-medium">
              Type <span className="font-mono text-foreground">{expected}</span> to
              confirm
            </Label>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="text-muted-foreground"
              onClick={() => void copyExpected()}
              disabled={deleting}
              aria-label={`Copy “${expected}” to the clipboard`}
            >
              {copied ? <Check /> : <Copy />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <Input
            id="delete-confirm"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            disabled={deleting}
            autoComplete="off"
            autoFocus
          />
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={!confirmed || deleting}
            onClick={(event) => {
              // Radix closes on Action by default; the close has to wait for
              // the two round trips, so the dialog drives it in `remove`.
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
