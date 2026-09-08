"use client";

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

/**
 * Confirm before forgetting one conversation.
 *
 * Deliberately plainer than DeleteProjectDialog: no type-to-confirm. That
 * ceremony guards a checkout on disk that a wrong click cannot get back; a chat
 * is one row and one transcript, and asking an operator to retype its title
 * every time they tidy the sidebar would train them to stop reading the dialog.
 *
 * Both menus share this one component -- the header menu deleting the open
 * chat, and the sidebar deleting any row -- so `onConfirm` carries the whole
 * difference between them.
 */
export default function DeleteChatDialog({
  open,
  onOpenChange,
  title,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The conversation's title, shown in the heading. */
  title?: string;
  /** Resolves when the delete landed; throwing leaves the dialog open. */
  onConfirm: () => Promise<void>;
}) {
  const [deleting, setDeleting] = useState(false);

  async function remove() {
    setDeleting(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch {
      // Left open on purpose, with the button live again: the caller has
      // already raised a toast saying what went wrong, and closing would look
      // exactly like a success.
    } finally {
      setDeleting(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {title ? `Delete “${title}”?` : "Delete this chat?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            This removes the conversation and its transcript for good. Any files
            it wrote stay where they are. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={deleting}
            onClick={(event) => {
              // Radix closes on Action by default; the close has to wait for
              // the round trip, so `remove` drives it.
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
