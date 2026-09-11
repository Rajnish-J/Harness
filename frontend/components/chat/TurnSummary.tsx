"use client";

import TranscriptDisclosure from "./TranscriptDisclosure";
import type { TranscriptItem } from "@/lib/types";

type Summary = Extract<TranscriptItem, { kind: "turn_summary" }>;

/**
 * What a finished turn cost, as the last row on its rail.
 *
 * Collapsed by default and deliberately quiet: the cost of a turn is worth
 * being able to check, not worth reading every time. It reuses
 * TranscriptDisclosure rather than styling its own row, so it lands on the same
 * rail as the steps above it with the same hover tint and the same chevron --
 * a summary that looked like a different kind of object would read as a new
 * message rather than as the end of the one just finished.
 */
export default function TurnSummary({ item }: { item: Summary }) {
  const total = item.inputTokens + item.outputTokens;

  return (
    <TranscriptDisclosure
      dot={
        // Hollow rather than coloured: every other dot on this rail reports a
        // status, and this row reports none -- the turn is simply over.
        <span
          className="relative mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/40 ring-2 ring-background"
          aria-hidden
        />
      }
      summary={
        <span className="flex w-full items-center gap-2 text-muted-foreground">
          <span>
            Completed in {item.steps} {item.steps === 1 ? "step" : "steps"}
          </span>
          {/* tabular-nums so the count does not jitter as it grows. */}
          <span className="ml-auto shrink-0 tabular-nums">
            {total.toLocaleString()}
          </span>
        </span>
      }
    >
      <dl className="ml-4 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 rounded border bg-muted/50 px-2 py-1.5 text-[11px] text-muted-foreground">
        <Row label="Work done" value={`${item.steps} ${item.steps === 1 ? "step" : "steps"}`} />
        {/* The same number as `steps`, said the other way round. Every step on
            this rail IS a tool call today; these are two readings of one fact,
            not two facts that can disagree. */}
        <Row
          label="Tools used"
          value={`${item.toolCalls} ${item.toolCalls === 1 ? "call" : "calls"}`}
        />
        <Row label="Tokens used" value={`${total.toLocaleString()} total`} />
        <Row label="Input" value={`${item.inputTokens.toLocaleString()} tokens`} />
        <Row label="Output" value={`${item.outputTokens.toLocaleString()} tokens`} />
      </dl>
    </TranscriptDisclosure>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd className="text-right tabular-nums text-foreground">{value}</dd>
    </>
  );
}
