"use client";

import { ScrollArea } from "@/components/ui/scroll-area";
import TranscriptDisclosure from "./TranscriptDisclosure";
import type { TranscriptItem } from "@/lib/types";

type Step = Extract<TranscriptItem, { kind: "step" }>;

const STATUS_DOT: Record<Step["status"], string> = {
  running: "bg-amber-500 animate-pulse",
  ok: "bg-emerald-500",
  error: "bg-red-500",
};

/** Render tool arguments compactly: `path="hello.txt"` rather than raw JSON. */
function summarizeArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args);
  if (entries.length === 0) return "";
  return entries
    .map(([key, value]) => {
      if (typeof value === "string") {
        const clipped =
          value.length > 40 ? `${value.slice(0, 40)}…` : value;
        return `${key}="${clipped.replace(/\n/g, "\\n")}"`;
      }
      return `${key}=${JSON.stringify(value)}`;
    })
    .join(", ");
}

export default function AgentStepIndicator({ step }: { step: Step }) {
  const args = summarizeArgs(step.arguments);

  return (
    <TranscriptDisclosure
      // A step still running has no result to show yet, so it renders without
      // an expand control rather than with one that opens an empty box.
      disabled={step.result === undefined}
      dot={
        // ring-background, not a plain dot: the rail runs behind it, and the
        // ring is what makes the line read as passing under each step rather
        // than colliding with it.
        <span
          className={`relative mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ring-2 ring-background ${STATUS_DOT[step.status]}`}
          aria-hidden
        />
      }
      summary={
        <>
          <span
            className={
              step.status === "error"
                ? "text-red-600 dark:text-red-400"
                : "text-muted-foreground"
            }
          >
            {step.name}
          </span>
          {args && <span className="text-muted-foreground">({args})</span>}
        </>
      }
    >
      {step.result !== undefined && (
        <ScrollArea
          className={`ml-4 max-h-64 rounded border ${
            step.status === "error"
              ? "border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-300"
              : "border bg-muted/50 text-muted-foreground"
          }`}
        >
          <pre className="px-2 py-1.5 text-[11px] leading-relaxed whitespace-pre-wrap break-words">
            {step.result}
          </pre>
        </ScrollArea>
      )}
    </TranscriptDisclosure>
  );
}
