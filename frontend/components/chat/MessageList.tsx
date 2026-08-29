"use client";

import { useEffect, useRef } from "react";
import AgentStepIndicator from "./AgentStepIndicator";
import ApprovalCard from "./ApprovalCard";
import MessageBubble from "./MessageBubble";
import { ScrollArea } from "@/components/ui/scroll-area";
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

  // No `flex-1` here on purpose: taking the free space is what used to push the
  // composer to the bottom edge on an empty chat. As a shrink-0 block it sits
  // directly above the composer, and ChatWindow's `justify-center` centres the
  // pair as one group.
  if (items.length === 0) {
    return (
      <div className="flex shrink-0 flex-col items-center gap-1.5 px-6 pb-6 text-center">
        <h2 className="text-lg font-semibold">What should the harness work on?</h2>
        <p className="text-sm text-muted-foreground">
          File tools, scoped to a sandboxed workspace.
        </p>
      </div>
    );
  }

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="flex flex-col gap-3 px-4 py-6">
        {items.map((item) => {
          if (item.kind === "step") {
            return <AgentStepIndicator key={item.id} step={item} />;
          }
          if (item.kind === "approval") {
            return <ApprovalCard key={item.id} item={item} />;
          }
          return <MessageBubble key={item.id} item={item} />;
        })}

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
    </ScrollArea>
  );
}
