"use client";

import { useEffect, useRef } from "react";
import AgentStepIndicator from "./AgentStepIndicator";
import MessageBubble from "./MessageBubble";
import type { TranscriptItem } from "@/lib/types";

export default function MessageList({
  items,
  streaming,
}: {
  items: TranscriptItem[];
  streaming: boolean;
}) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [items, streaming]);

  if (items.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-sm text-muted-foreground">
          The agent has file tools scoped to a sandboxed workspace.
        </p>
        <p className="max-w-md font-mono text-xs text-muted-foreground">
          Try: &ldquo;list the files, then create notes.md with three bullet
          points about agent loops, and read it back&rdquo;
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-6">
      {items.map((item) =>
        item.kind === "step" ? (
          <AgentStepIndicator key={item.id} step={item} />
        ) : (
          <MessageBubble key={item.id} item={item} />
        ),
      )}

      {streaming && (
        <div
          className="flex items-center gap-1.5 px-2 text-xs text-muted-foreground"
          aria-live="polite"
        >
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground" />
          working…
        </div>
      )}

      <div ref={endRef} />
    </div>
  );
}
