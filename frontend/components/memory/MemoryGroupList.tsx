"use client";

import { Brain, type LucideIcon } from "lucide-react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import EmptyState from "@/components/registry/EmptyState";
import type { Memory } from "@/lib/memory-api";
import { relativeTime } from "@/lib/relative-time";

export type MemoryGroup = {
  id: string;
  label: string;
  /** The line under the label: a project's scope, a session's message count. */
  caption?: string;
  memories: Memory[];
  /** Dims the group and greys its rows — used for deleted sessions. */
  muted?: boolean;
};

/**
 * Memories under collapsible headings, for grouping by project or by session.
 *
 * One component for both tabs because the two views differ only in how the
 * groups are computed — a second near-identical list would drift the moment
 * either was touched. Groups open by default (`defaultValue` on every id):
 * this is a page you visit to read, not to navigate, so hiding everything
 * behind a click would make it useless at a glance.
 */
export default function MemoryGroupList({
  groups,
  emptyTitle,
  emptyDescription,
  emptyIcon = Brain,
}: {
  groups: MemoryGroup[];
  emptyTitle: string;
  emptyDescription?: string;
  emptyIcon?: LucideIcon;
}) {
  if (groups.length === 0) {
    return (
      <EmptyState icon={emptyIcon} title={emptyTitle} description={emptyDescription} />
    );
  }

  return (
    <Accordion
      type="multiple"
      defaultValue={groups.map((group) => group.id)}
      className="flex flex-col gap-2"
    >
      {groups.map((group) => (
        <AccordionItem
          key={group.id}
          value={group.id}
          // `last:border-b` re-asserts what AccordionItem's own
          // `last:border-b-0` would strip — these are cards, not a stacked
          // list, so the bottom edge has to stay on the final one.
          className="rounded-xl border last:border-b bg-card px-3"
        >
          <AccordionTrigger className="py-3 hover:no-underline">
            <span className="flex min-w-0 flex-col items-start text-left">
              <span
                className={`truncate text-sm font-medium ${
                  group.muted ? "text-muted-foreground" : ""
                }`}
              >
                {group.label}
              </span>
              {group.caption && (
                <span className="truncate text-[11px] text-muted-foreground">
                  {group.caption}
                </span>
              )}
            </span>
            <span className="ml-auto mr-2 shrink-0 text-[11px] text-muted-foreground">
              {group.memories.length}
            </span>
          </AccordionTrigger>

          <AccordionContent className="pb-3">
            {group.memories.length === 0 ? (
              <p className="px-1 pb-1 text-xs text-muted-foreground">
                Nothing remembered here yet.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {group.memories.map((memory) => (
                  <li key={memory.id}>
                    <MemoryRow memory={memory} />
                  </li>
                ))}
              </ul>
            )}
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}

/** Scope colour matches /memory's cards: sky = global, purple = project. */
function MemoryRow({ memory }: { memory: Memory }) {
  const scopeClass = memory.project_id
    ? "bg-purple-50 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300"
    : "bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300";

  return (
    <div className="rounded-lg border border-border px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${scopeClass}`}>
          {memory.kind}
        </span>
        <span className="text-sm font-medium">{memory.title}</span>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
          {memory.slug}
        </span>
      </div>
      <p className="mt-1 text-xs leading-snug text-muted-foreground">{memory.content}</p>
      <p className="mt-1 text-[10px] text-muted-foreground/80">
        {memory.project_id ? "Project" : "Global"} ·{" "}
        {memory.source === "agent" ? "written by the agent" : "added by hand"} ·{" "}
        {relativeTime(memory.updated_at)}
      </p>
    </div>
  );
}
