"use client";

import { CircleQuestionMark } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * What the composer's controls actually do.
 *
 * This replaces the permanent "⏎ send · ⇧⏎ newline" string that used to sit in
 * the control row: the shortcuts are still here, they just no longer cost a
 * line of chrome on every screen. The other four rows are the things that were
 * previously discoverable only by clicking them.
 */
const HINTS: { key: string; text: string }[] = [
  { key: "/", text: "Attach a skill or agent by name" },
  { key: "+", text: "Attach agents, skills and MCP servers" },
  { key: "Tools", text: "Which tools this turn may call, by group" },
  { key: "MCP", text: "Connected servers' tools — manage them at /mcp" },
  { key: "⏎ / ⇧⏎", text: "Send · newline" },
];

export default function ComposerHelp() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 rounded-full text-muted-foreground"
          aria-label="What the composer controls do"
        >
          <CircleQuestionMark className="size-4" />
        </Button>
      </TooltipTrigger>

      <TooltipContent side="top" align="end" className="max-w-xs">
        <dl className="flex flex-col gap-1">
          {HINTS.map((hint) => (
            <div key={hint.key} className="flex gap-2">
              <dt className="w-14 shrink-0 font-mono opacity-80">{hint.key}</dt>
              <dd className="min-w-0 flex-1">{hint.text}</dd>
            </div>
          ))}
        </dl>
      </TooltipContent>
    </Tooltip>
  );
}
