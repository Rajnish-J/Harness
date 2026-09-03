"use client";

import { useEffect, useRef } from "react";
import AgentStepIndicator from "./AgentStepIndicator";
import ApprovalCard from "./ApprovalCard";
import MessageBubble from "./MessageBubble";
import ProjectProposalCard from "./ProjectProposalCard";
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

  // Content-sized, NOT flex-1: the greeting has to hug the composer so
  // ChatWindow's `justify-center` can center the pair as one group. Making this
  // fill instead would eat all the free space, leaving nothing to distribute
  // and stranding the composer at the bottom edge with a gap above it.
  if (items.length === 0) {
    return (
      <div className="flex shrink-0 flex-col items-center justify-center gap-1.5 px-6 pb-6 text-center">
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
          if (item.kind === "project_proposal") {
            return <ProjectProposalCard key={item.id} item={item} />;
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
