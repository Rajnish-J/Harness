"use client";

import { ArrowDown } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import AgentStepIndicator from "./AgentStepIndicator";
import AttachProposalCard from "./AttachProposalCard";
import ApprovalCard from "./ApprovalCard";
import McpConsentCard from "./McpConsentCard";
import MessageBubble from "./MessageBubble";
import ProjectProposalCard from "./ProjectProposalCard";
import ToolSelectionStep from "./ToolSelectionStep";
import TurnSummary from "./TurnSummary";
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
  // What the harness is doing right now, in the two states we can
  // actually observe. A running step means a tool is executing and we
  // know which; anything else means we are waiting on the model to
  // decide what to do next.
  //
  // There is deliberately no "Writing…" here. An assistant message
  // arrives as ONE complete event, not token by token, so there is no
  // interval during which the harness is observably writing -- a label
  // saying so would be a guess rendered as a fact.
  const last = items.at(-1);
  const streamingLabel =
    last?.kind === "step" && last.status === "running"
      ? `Running ${last.name}…`
      : "Thinking…";
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
          // shrink-0 stays: ChatWindow's `justify-center` needs free space to
          // distribute, and flex-1 here would eat it. The width cap is now
          // ours to apply -- ChatWindow gave it up so the scrollbar could
          // reach the window edge.
          rail ? "min-h-0 flex-1" : "mx-auto w-full max-w-4xl shrink-0 pb-6",
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
            // The two variants want DIFFERENT padding, for one reason.
            //
            // On the rail the scrollbar still sits in this column's own right
            // gutter, so pr- stays a touch wider than pl-: matched padding
            // would leave the text visually closer to that edge than to the
            // left one.
            //
            // On the page the bar has moved out to the window edge, well
            // clear of this centred column -- so the asymmetry now reads as
            // the text simply sitting off-centre inside its own box. Even
            // padding, and the cap that ChatWindow used to apply.
            rail
              ? "gap-2.5 py-4 pl-3 pr-4"
              : "mx-auto w-full max-w-4xl gap-3 px-4 py-6",
          )}
        >
          {items.map((item) => {
            if (item.kind === "step") {
              return <AgentStepIndicator key={item.id} step={item} />;
            }
            if (item.kind === "tool_selection") {
              return <ToolSelectionStep key={item.id} item={item} />;
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
            if (item.kind === "mcp_consent") {
              return <McpConsentCard key={item.id} item={item} />;
            }
            if (item.kind === "turn_summary") {
              return <TurnSummary key={item.id} item={item} />;
            }
            return (
              <MessageBubble key={item.id} item={item} variant={variant} />
            );
          })}

          {streaming && (
            // Padding and gap match a step row's, so this dot lands on the same
            // rail the steps above it hang off rather than floating beside it.
            <div
              className="relative flex items-start gap-2 px-2 py-1 font-mono text-xs text-muted-foreground"
              aria-live="polite"
            >
              {/* Only upward: nothing follows, so the rail stops at this dot.
                  Geometry matches TranscriptDisclosure's Rail -- see its note. */}
              <span
                className="absolute -top-2.5 bottom-1/2 left-[10.5px] w-px bg-border"
                aria-hidden
              />
              <span className="relative mt-1.5 h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-muted-foreground ring-2 ring-background" />
              {streamingLabel}
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
          // Centred rather than pinned right. This wrapper is now the full
          // width of the viewport on the page variant, so `right-4` would
          // strand the button against the window edge, far from the column it
          // belongs to. Centring follows the transcript on both variants
          // without either having to know how wide the other is.
          className="absolute bottom-3 left-1/2 h-7 -translate-x-1/2 gap-1 rounded-full px-2.5 text-xs shadow-md"
        >
          <ArrowDown className="size-3.5" />
          Jump to latest
        </Button>
      )}
    </div>
  );
}
