"use client";

import {
  Check,
  ClipboardCheck,
  Layers,
  MessageSquare,
  Sparkle,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { LucideIcon } from "lucide-react";

import { useChatPreset } from "@/components/chat/ChatPresetProvider";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { ToolMode } from "@/lib/chat-preset";

const MODES: {
  id: ToolMode;
  label: string;
  description: string;
  icon: LucideIcon;
}[] = [
  {
    // Labelled "Auto", not "Agent": the agent *pill* sits right beside this one
    // in the composer row, and two controls reading "Agent" is a coin toss.
    // Only the label changes — the id is the wire value (backend ToolMode).
    id: "agent",
    label: "Auto",
    description: "The harness runs tool calls automatically, without asking.",
    icon: Sparkle,
  },
  {
    id: "manual",
    label: "Manual",
    description: "Review and approve every tool call before it executes.",
    icon: ClipboardCheck,
  },
  {
    id: "chat",
    label: "Chat",
    description: "Plain Q&A — no tools are offered to the model at all.",
    icon: MessageSquare,
  },
];

export function modeLabel(mode: ToolMode): string {
  return MODES.find((entry) => entry.id === mode)?.label ?? "Auto";
}

/**
 * How this turn treats tools.
 *
 * Orchestrator is listed but is not a mode: a multi-agent pipeline is a graph,
 * and this app already has an editor for one. Sending it to /workflows is
 * honest about that rather than shipping a fourth mode that quietly runs a
 * single agent.
 */
export default function ModeSelector() {
  const [open, setOpen] = useState(false);
  const { preset, setMode } = useChatPreset();

  const active = MODES.find((entry) => entry.id === preset.mode) ?? MODES[0];
  const ActiveIcon = active.icon;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 rounded-full px-2.5 text-xs font-normal"
          aria-label={`Tool mode: ${active.label}`}
        >
          <ActiveIcon className="size-3.5 opacity-70" />
          {active.label}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-80 p-1.5">
        <p className="px-2 pt-1 pb-2 text-[11px] font-medium text-muted-foreground">
          Select tool mode
        </p>

        {MODES.map((entry) => {
          const Icon = entry.icon;
          const selected = entry.id === preset.mode;

          return (
            <button
              key={entry.id}
              type="button"
              onClick={() => {
                setMode(entry.id);
                setOpen(false);
              }}
              className="flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-accent"
            >
              <Icon className="mt-0.5 size-4 shrink-0 opacity-70" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{entry.label}</span>
                <span className="block text-[11px] text-muted-foreground">
                  {entry.description}
                </span>
              </span>
              {selected && <Check className="mt-0.5 size-3.5 shrink-0" />}
            </button>
          );
        })}

        <div className="my-1 border-t" />

        <Link
          href="/workflows"
          onClick={() => setOpen(false)}
          className="flex items-start gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-accent"
        >
          <Layers className="mt-0.5 size-4 shrink-0 opacity-70" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">Orchestrator</span>
            <span className="block text-[11px] text-muted-foreground">
              Multi-agent pipeline — build one on the workflow canvas.
            </span>
          </span>
        </Link>
      </PopoverContent>
    </Popover>
  );
}
