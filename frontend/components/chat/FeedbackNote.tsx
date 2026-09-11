"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

/**
 * "What were you expecting?" — the note behind a thumbs-down.
 *
 * The note is what makes a thumbs-down worth more than a tally: it becomes a
 * memory scoped to this one conversation, so the next turn's system prompt
 * carries it. That is invisible from the outside, which is why saving says so
 * in as many words rather than just closing the box.
 *
 * Entirely optional. The vote is already recorded by the time this appears, so
 * dismissing costs the user nothing and is not a cancel.
 */
export default function FeedbackNote({
  saved,
  onSubmit,
  onDismiss,
}: {
  /** The note already stored for this message, if the user has written one. */
  saved: string | null;
  onSubmit: (note: string) => Promise<void>;
  onDismiss: () => void;
}) {
  const [text, setText] = useState(saved ?? "");
  const [saving, setSaving] = useState(false);

  async function submit() {
    const note = text.trim();
    if (!note || saving) return;

    setSaving(true);
    try {
      await onSubmit(note);
      toast.success("Noted — this chat will remember.");
      onDismiss();
    } catch (error) {
      toast.error({
        title: "Could not save that note",
        description:
          error instanceof Error
            ? error.message
            : "The harness backend did not accept it.",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-2 w-full max-w-lg rounded-lg border bg-muted/30 p-2">
      <textarea
        // Not autoFocus: this box appears as a side effect of clicking a
        // thumb, and stealing the caret out of the composer on a click the
        // user may have meant as a one-tap vote is the wrong trade.
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void submit();
          }
          if (event.key === "Escape") onDismiss();
        }}
        rows={2}
        placeholder="What were you expecting?"
        aria-label="What were you expecting?"
        className={cn(
          "w-full resize-none rounded-md border bg-background px-2 py-1.5 text-sm",
          "outline-none focus-visible:ring-1 focus-visible:ring-ring",
        )}
      />
      <div className="mt-1.5 flex items-center justify-end gap-1.5">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          onClick={onDismiss}
        >
          Dismiss
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-7 px-2.5 text-xs"
          onClick={() => void submit()}
          disabled={!text.trim() || saving}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
