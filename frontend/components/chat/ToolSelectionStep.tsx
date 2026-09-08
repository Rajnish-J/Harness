"use client";

import { useState } from "react";

import { groupPresentation } from "@/lib/tool-groups";
import type { TranscriptItem } from "@/lib/types";
import { cn } from "@/lib/utils";

type Selection = Extract<TranscriptItem, { kind: "tool_selection" }>;

/**
 * What the harness decided this turn was allowed to see, before it ran.
 *
 * Collapsed it is one line on the same rail as AgentStepIndicator, so the
 * transcript still reads as a single column of steps. Expanded it is the
 * vertical stepper: one row per tool, with the group icon and label the
 * composer and /tools already use, so a tool looks the same everywhere.
 *
 * The narrowing is shown rather than assumed. A turn that quietly dropped
 * thirty tools and then said "I can't do that" would be indistinguishable from
 * a model that simply refused, and this is the line that tells them apart.
 */
export default function ToolSelectionStep({ item }: { item: Selection }) {
  const [open, setOpen] = useState(false);

  const count = item.selected.length;
  const narrowed = item.ran && item.poolSize > count;

  // A router that failed open kept everything, so "selected N of N" would be a
  // lie by omission. Its note is the whole message.
  const summary = item.ran
    ? narrowed
      ? `Selected ${count} of ${item.poolSize} tools`
      : `Kept all ${item.poolSize} tools`
    : `All ${item.poolSize} tools offered`;

  return (
    <div className="my-1 font-mono text-xs">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-start gap-2 rounded px-2 py-1 text-left transition-colors hover:bg-accent"
        aria-expanded={open}
      >
        <span
          className={cn(
            "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
            item.ran ? "bg-sky-500" : "bg-muted-foreground/50",
          )}
          aria-hidden
        />
        <span className="min-w-0 flex-1 text-muted-foreground">
          {summary}
          {item.reason && (
            <span className="text-muted-foreground/70"> — {item.reason}</span>
          )}
        </span>
        <span className="shrink-0 text-muted-foreground">{open ? "−" : "+"}</span>
      </button>

      {open && (
        <div className="mt-1 ml-6 space-y-1.5">
          {item.note && (
            <p className="rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1.5 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
              {item.note}
            </p>
          )}

          {count > 0 && (
            // The rail: one continuous line down the left with each tool
            // hanging off it. The last row's segment stops at its own dot, so
            // the line ends with the list rather than trailing into whitespace.
            // Done by index rather than with `last:` — that variant matches the
            // last CHILD, and this span is the first child of its row.
            <ul className="space-y-0">
              {item.selected.map((tool, index) => {
                const { icon: Icon } = groupPresentation(tool.group);
                const isLast = index === item.selected.length - 1;
                return (
                  <li key={tool.name} className="relative flex gap-2 pl-4">
                    <span
                      className={cn(
                        "absolute top-0 left-[3px] w-px bg-border",
                        isLast ? "h-[10px]" : "bottom-0",
                      )}
                      aria-hidden
                    />
                    <span
                      className="absolute top-[7px] left-0 h-[7px] w-[7px] rounded-full border border-border bg-background"
                      aria-hidden
                    />
                    <Icon
                      className="mt-[3px] h-3 w-3 shrink-0 text-muted-foreground/70"
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 py-[1px]">
                      <span className="text-foreground/80">{tool.name}</span>
                      <span className="ml-2 text-muted-foreground/60">
                        {tool.group}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          {item.model && (
            <p className="text-[11px] text-muted-foreground/60">
              chosen by {item.model}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
