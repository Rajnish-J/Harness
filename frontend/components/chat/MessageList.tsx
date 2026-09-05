"use client";

import { ArrowDown } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import AgentStepIndicator from "./AgentStepIndicator";
import AttachProposalCard from "./AttachProposalCard";
import ApprovalCard from "./ApprovalCard";
import MessageBubble from "./MessageBubble";
import ProjectProposalCard from "./ProjectProposalCard";
import type { ChatVariant } from "./variant";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { TranscriptItem } from "@/lib/types";
import { cn } from "@/lib/utils";

/** How close to the bottom still counts as "following along". */
const STICK_SLOP_PX = 64;

export default function MessageList({
  items,
  streaming,
  variant = "page",
}: {
  items: TranscriptItem[];
  streaming: boolean;
  variant?: ChatVariant;
}) {
  const rail = variant === "rail";
  // The ScrollArea only exists once there is a transcript, so the listener has
  // to be re-attached when the empty state gives way to it.
  const hasItems = items.length > 0;
  const endRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  // A ref, not state: this updates on every scroll frame and re-rendering the
  // whole transcript that often would be visible.
  const stickRef = useRef(true);
  const [showJump, setShowJump] = useState(false);

  // Radix scrolls the viewport, not the Root that takes our className. There is
  // no ref prop for it, so it is queried off the root once. `scroll-area-viewport`
  // is set by components/ui/scroll-area.tsx.
  const setRoot = useCallback((node: HTMLDivElement | null) => {
    viewportRef.current =
      node?.querySelector<HTMLDivElement>("[data-slot=scroll-area-viewport]") ??
      null;
  }, []);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const onScroll = () => {
      const atBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight < STICK_SLOP_PX;
      stickRef.current = atBottom;
      // Only touches state when the boolean actually flips.
      setShowJump((prev) => (prev === !atBottom ? prev : !atBottom));
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [hasItems]);

  // Follow new output only while the reader is already at the bottom. Scrolling
  // up to re-read something used to be undone by the next event.
  useEffect(() => {
    if (!stickRef.current) return;
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [items, streaming]);

  const jumpToLatest = useCallback(() => {
    stickRef.current = true;
    setShowJump(false);
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, []);

  // Content-sized, NOT flex-1: the greeting has to hug the composer so
  // ChatWindow's `justify-center` can center the pair as one group. Making this
  // fill instead would eat all the free space, leaving nothing to distribute
  // and stranding the composer at the bottom edge with a gap above it.
  //
  // The rail is the exception: there the composer belongs at the bottom, so the
  // greeting fills instead and the empty state sits at the top of its own space.
  if (items.length === 0) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center gap-1.5 px-6 text-center",
          rail ? "min-h-0 flex-1" : "shrink-0 pb-6",
        )}
      >
        <h2 className={cn("font-semibold", rail ? "text-sm" : "text-lg")}>
          What should the harness work on?
        </h2>
        <p
          className={cn(
            "text-muted-foreground",
            rail ? "text-xs" : "text-sm",
          )}
        >
          File tools, scoped to a sandboxed workspace.
        </p>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <ScrollArea ref={setRoot} className="min-h-0 flex-1">
        <div
          className={cn(
            "flex min-w-0 flex-col",
            // pr- is a touch wider than pl- on both variants: the scrollbar
            // sits in the right gutter, and matched padding would leave the
            // text visually closer to that edge than to the left one.
            rail ? "gap-2.5 py-4 pl-3 pr-4" : "gap-3 py-6 pl-4 pr-5",
          )}
        >
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
            if (item.kind === "attach_proposal") {
              return <AttachProposalCard key={item.id} item={item} />;
            }
            return (
              <MessageBubble key={item.id} item={item} variant={variant} />
            );
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

      {showJump && (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={jumpToLatest}
          className="absolute bottom-3 right-4 h-7 gap-1 rounded-full px-2.5 text-xs shadow-md"
        >
          <ArrowDown className="size-3.5" />
          Jump to latest
        </Button>
      )}
    </div>
  );
}
