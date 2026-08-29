"use client";

import { Check, ShieldQuestion, X } from "lucide-react";

import { useChatPreset } from "@/components/chat/ChatPresetProvider";
import { useChatSession } from "@/components/chat/ChatSessionProvider";
import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import type { TranscriptItem } from "@/lib/types";

type Approval = Extract<TranscriptItem, { kind: "approval" }>;

/**
 * A manual-mode tool call waiting on a verdict.
 *
 * Arguments are shown in full rather than summarised the way a finished step
 * is: this is the one moment where the exact path being written to is the
 * whole point of the card.
 */
export default function ApprovalCard({ item }: { item: Approval }) {
  const { resolveApprovals, streaming } = useChatSession();
  const { preset } = useChatPreset();

  if (item.decision) {
    return (
      <p className="px-2 font-mono text-[11px] text-muted-foreground">
        {item.decision === "approved" ? "approved" : "denied"} · {item.name}
      </p>
    );
  }

  const decide = (approved: boolean) =>
    void resolveApprovals([{ id: item.id, approved }], preset);

  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-xs font-medium">
        <ShieldQuestion className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
        Approve <span className="font-mono">{item.name}</span>?
      </p>

      <ScrollArea className="mt-1.5 max-h-40 rounded-md bg-background/70">
        <pre className="p-2 font-mono text-[11px]">
          {JSON.stringify(item.arguments, null, 2)}
        </pre>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>

      <div className="mt-2 flex gap-2">
        <Button
          type="button"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          disabled={streaming}
          onClick={() => decide(true)}
        >
          <Check className="size-3.5" />
          Approve
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 text-xs"
          disabled={streaming}
          onClick={() => decide(false)}
        >
          <X className="size-3.5" />
          Deny
        </Button>
      </div>
    </div>
  );
}
