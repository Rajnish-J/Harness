"use client";

import { ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

/**
 * One expandable row on the transcript's step rail.
 *
 * AgentStepIndicator and ToolSelectionStep had drifted into the same component
 * twice over -- the same `useState`, the same button, the same `+`/`−` glyph --
 * so the chrome lives here once and each caller supplies only its own dot,
 * summary and body.
 *
 * Built on Collapsible rather than Accordion because these rows are independent
 * toggles: several can be open at once, and there is no single value to track.
 * Accordion would also arrive with `border-b` and `py-4 hover:underline` to
 * fight off, none of which suits a dense mono row.
 *
 * The whole row -- trigger and body together -- sits inside one `group` so
 * hovering anywhere tints both as a single surface rather than lighting up the
 * header alone while the list under it stays on the page background.
 *
 * The colors here are LITERAL, and deliberately not `hover:bg-accent` like the
 * rest of the app -- pinned rather than following a token someone may retheme.
 * gray-50 light / slate-900 dark for the row, and one step lighter (gray-100 /
 * slate-800) when it is open, so an expanded row still separates from a
 * collapsed one without the list under it turning into a slab. Please do not
 * "fix" them back to the token.
 */
export default function TranscriptDisclosure({
  dot,
  summary,
  children,
  disabled = false,
  defaultOpen = false,
}: {
  /** The status dot. Rendered by the caller so each row keeps its own colour. */
  dot: ReactNode;
  /** The always-visible line. */
  summary: ReactNode;
  /** The expanded body. Not rendered at all when `disabled`. */
  children?: ReactNode;
  /** No body to show -- a running step. Renders the row with no affordance. */
  disabled?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  // A running step has nothing to expand yet. Rendering the same markup minus
  // the trigger keeps it on the rail without offering a control that would do
  // nothing -- and without shifting the row when the result arrives.
  if (disabled) {
    return (
      <div className="relative my-1 font-mono text-xs">
        <Rail />
        <div className="flex w-full items-start gap-2 rounded px-2 py-1">
          {dot}
          <span className="min-w-0 flex-1">{summary}</span>
        </div>
      </div>
    );
  }

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={cn(
        "group relative my-1 rounded font-mono text-xs transition-colors",
        "hover:bg-gray-50 dark:hover:bg-slate-900",
        "data-[state=open]:hover:bg-gray-100 dark:data-[state=open]:hover:bg-slate-800",
      )}
    >
      <Rail />
      <CollapsibleTrigger className="flex w-full cursor-pointer items-start gap-2 rounded px-2 py-1 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50">
        {dot}
        <span className="min-w-0 flex-1">{summary}</span>
        <ChevronDown
          className="mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180"
          aria-hidden
        />
      </CollapsibleTrigger>

      <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
        <div className="px-2 pb-1.5">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * The line joining one step's dot to the next.
 *
 * Drawn per row rather than once behind the list, because the rows are flex
 * siblings with a gap between them and nothing spans that gap -- a single
 * absolute line on the container would also have to know where the first and
 * last STEP are, and the transcript interleaves steps with message bubbles and
 * cards.
 *
 * So each row draws its own segment and lets it overhang top and bottom by
 * more than the gap; consecutive steps' segments overlap into one continuous
 * rail, and a step with a bubble above or below it just has a short stub that
 * reads as the line entering and leaving.
 *
 * The two numbers are measured, not guessed:
 *
 * - `left-[10.5px]` centres a 1px line on the dot. The dot is 6px wide and
 *   starts after the row's 8px `px-2`, so its centre is at 11px and the line
 *   must start half its own width before that.
 * - `-top-2.5 -bottom-2.5` is 10px each way. Consecutive rows are 18px apart
 *   (`my-1` + the list's `gap-2.5` + `my-1`), so 8px would leave a 2px break;
 *   10px overlaps by 2px and the rail reads as continuous.
 *
 * The line is drawn UNDER the dots by document order alone -- no z-index,
 * which would have to out-rank the hover tint too; the dots carry a background
 * ring instead, so the rail visibly passes behind each one.
 */
function Rail() {
  return (
    <span
      className="absolute -top-2.5 -bottom-2.5 left-[10.5px] w-px bg-border"
      aria-hidden
    />
  );
}
