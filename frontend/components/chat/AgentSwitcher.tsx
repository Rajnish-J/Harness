"use client";

import { Bot, Check, ChevronDown } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { useChatPreset } from "@/components/chat/ChatPresetProvider";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { describePreset } from "@/lib/chat-preset";

/**
 * Always-visible indicator of who you are talking to.
 *
 * Deliberately not hidden behind the "+" menu: the active agent changes the
 * system prompt and the tool surface, and a setting that consequential should
 * not be something you have to open a menu to discover.
 */
export default function AgentSwitcher() {
  const [open, setOpen] = useState(false);
  const { preset, catalog, setAgent } = useChatPreset();

  const summary = describePreset(preset);

  return (
    <div className="flex items-center gap-2 px-1 pb-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs"
          >
            <Bot className="size-3.5" />
            {preset.agent ? preset.agent.name : "No agent"}
            <ChevronDown className="size-3 opacity-50" />
          </Button>
        </PopoverTrigger>

        <PopoverContent align="start" className="w-72 p-0">
          <Command>
            <CommandInput placeholder="Switch agent…" />
            <CommandList>
              <CommandEmpty>No agents found.</CommandEmpty>
              <CommandGroup>
                <CommandItem
                  value="no agent"
                  onSelect={() => {
                    void setAgent(null);
                    setOpen(false);
                  }}
                >
                  <Bot className="opacity-50" />
                  <div className="flex flex-col">
                    <span>No agent</span>
                    <span className="text-[11px] text-muted-foreground">
                      The default harness prompt
                    </span>
                  </div>
                  {!preset.agent && <Check className="ml-auto size-3.5" />}
                </CommandItem>

                {catalog.agents.map((agent) => (
                  <CommandItem
                    key={agent.id}
                    value={`${agent.name} ${agent.slug}`}
                    onSelect={() => {
                      void setAgent(agent);
                      setOpen(false);
                    }}
                  >
                    <Bot />
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate">
                        {agent.name}
                        {!agent.enabled && (
                          <span className="ml-1.5 text-[10px] text-muted-foreground">
                            disabled
                          </span>
                        )}
                      </span>
                      {agent.description && (
                        <span className="truncate text-[11px] text-muted-foreground">
                          {agent.description}
                        </span>
                      )}
                    </div>
                    {preset.agent?.id === agent.id && (
                      <Check className="ml-auto size-3.5" />
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>

              {catalog.agents.length === 0 && !catalog.loading && (
                <div className="px-3 py-2 text-[11px] text-muted-foreground">
                  No agents yet.{" "}
                  <Link href="/agents" className="underline underline-offset-2">
                    Create one
                  </Link>
                </div>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {summary && (
        <span className="truncate font-mono text-[10px] text-muted-foreground">
          {summary}
        </span>
      )}
    </div>
  );
}
