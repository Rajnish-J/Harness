"use client";

import { ThumbsDown, ThumbsUp } from "lucide-react";
import { useState } from "react";

import FeedbackNote from "./FeedbackNote";
import { useChatSession } from "./ChatSessionProvider";
import { cn } from "@/lib/utils";

/**
 * Was that reply any good?
 *
 * A thumbs-up is recorded and nothing more. A thumbs-down opens a note box,
 * because "wrong" on its own tells the model nothing it can act on — the note
 * becomes a memory scoped to this conversation, and the next turn reads it.
 *
 * Both are toggles: clicking the lit thumb again retracts the vote. There is
 * no third "neutral" state to reach, because not voting and un-voting are the
 * same fact.
 */
export default function MessageActions({ messageUid }: { messageUid: string }) {
  const { feedback, voteMessage, submitNote } = useChatSession();
  const current = feedback[messageUid];
  const vote = current?.vote ?? null;
  const [noteOpen, setNoteOpen] = useState(false);

  async function cast(next: "up" | "down") {
    // Clicking the lit thumb retracts it.
    const value = vote === next ? null : next;
    await voteMessage(messageUid, value);

    // Only ever opened by choosing thumbs-down, never by retracting one.
    setNoteOpen(value === "down");
  }

  return (
    <div className="mt-1">
      <div
        // Hidden until the message is hovered or focused, so a quiet
        // transcript stays quiet -- but ALWAYS visible once voted: a lit thumb
        // that disappeared on mouse-out would read as a vote that was lost.
        className={cn(
          "flex items-center gap-0.5 transition-opacity",
          vote
            ? "opacity-100"
            : "opacity-0 group-hover:opacity-100 focus-within:opacity-100",
        )}
      >
        <ThumbButton
          label="Good response"
          active={vote === "up"}
          onClick={() => void cast("up")}
        >
          <ThumbsUp className="size-3.5" aria-hidden />
        </ThumbButton>
        <ThumbButton
          label="Bad response"
          active={vote === "down"}
          onClick={() => void cast("down")}
        >
          <ThumbsDown className="size-3.5" aria-hidden />
        </ThumbButton>

        {/* Shown once a note exists, so the user can tell the model was
            actually taught something rather than merely downvoted. */}
        {current?.note && !noteOpen && (
          <button
            type="button"
            onClick={() => setNoteOpen(true)}
            className="ml-1 rounded px-1 text-[11px] text-muted-foreground underline-offset-2 hover:underline"
          >
            note saved
          </button>
        )}
      </div>

      {noteOpen && (
        <FeedbackNote
          saved={current?.note ?? null}
          onSubmit={(note) => submitNote(messageUid, note)}
          onDismiss={() => setNoteOpen(false)}
        />
      )}
    </div>
  );
}

function ThumbButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={cn(
        "rounded p-1 transition-colors",
        "hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
        active ? "text-foreground" : "text-muted-foreground",
      )}
    >
      {children}
    </button>
  );
}
