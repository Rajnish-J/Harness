"use client";

import { Bot, Check, Plug, Plus, Sparkles, X } from "lucide-react";
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
  CommandSeparator,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { isPresetEmpty } from "@/lib/chat-preset";

/**
 * The "+" menu: what this turn is talking to and reading from.
 *
 * Individual tools deliberately are NOT here — they moved to the Tools pill,
 * which can group them the way the harness does. A flat list of every tool
 * next to a flat list of every skill was the thing that made this menu hard to
 * scan.
 *
 * Command lives inside a Popover, where moving focus into the filter input is
 * the correct behaviour. That is exactly why the slash menu does NOT use it —
 * there, focus must stay in the textarea.
 */
export default function AttachMenu() {
  const [open, setOpen] = useState(false);
  const {
    preset,
    catalog,
    setAgent,
    attachSkill,
    detachSkill,
    toggleMcp,
    clearAttachments,
  } = useChatPreset();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          aria-label="Attach an agent, skill or MCP server"
        >
          <Plus />
        </Button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-80 p-0">
        <Command>
          <CommandInput placeholder="Attach an agent, skill or MCP server…" />
          <CommandList className="max-h-80">
            <CommandEmpty>Nothing matches.</CommandEmpty>

            <CommandGroup heading="Agents">
              <CommandItem
                value="no agent default"
                onSelect={() => void setAgent(null)}
              >
                <Bot className="opacity-50" />
                <span>No agent</span>
                <span className="ml-auto text-[11px] text-muted-foreground">
                  default prompt
                </span>
                {!preset.agent && <Check className="ml-1 size-3.5" />}
              </CommandItem>

              {catalog.agents.map((agent) => (
                <CommandItem
                  key={agent.id}
                  value={`agent ${agent.name} ${agent.slug}`}
                  onSelect={() => void setAgent(agent)}
                >
                  <Bot />
                  <span className="truncate">{agent.name}</span>
                  {!agent.enabled && (
                    <span className="text-[10px] text-muted-foreground">
                      disabled
                    </span>
                  )}
                  {preset.agent?.id === agent.id && (
                    <Check className="ml-auto size-3.5" />
                  )}
                </CommandItem>
              ))}

              {catalog.agents.length === 0 && !catalog.loading && (
                <EmptyHint href="/agents" label="No agents yet — create one" />
              )}
            </CommandGroup>

            <CommandSeparator />

            <CommandGroup heading="Skills">
              {catalog.skills.map((skill) => {
                const attached = preset.skills.some((s) => s.id === skill.id);
                return (
                  <CommandItem
                    key={skill.id}
                    value={`skill ${skill.name} ${skill.slug}`}
                    onSelect={() =>
                      attached ? detachSkill(skill.id) : void attachSkill(skill)
                    }
                  >
                    <Sparkles />
                    <span className="truncate">{skill.name}</span>
                    {attached && <Check className="ml-auto size-3.5" />}
                  </CommandItem>
                );
              })}

              {catalog.skills.length === 0 && !catalog.loading && (
                <EmptyHint href="/skills" label="No skills yet — write one" />
              )}
            </CommandGroup>

            <CommandSeparator />

            <CommandGroup heading="MCP servers">
              {catalog.mcp.map((server) => (
                <CommandItem
                  key={server.id}
                  value={`mcp ${server.name}`}
                  onSelect={() => toggleMcp(server)}
                >
                  <Plug />
                  <span className="truncate">{server.name}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {server.transport}
                  </span>
                  {preset.mcpServers.some((s) => s.id === server.id) && (
                    <Check className="ml-auto size-3.5" />
                  )}
                </CommandItem>
              ))}

              {catalog.mcp.length === 0 && !catalog.loading && (
                <EmptyHint href="/mcp" label="No MCP servers configured" />
              )}
            </CommandGroup>

            {!isPresetEmpty(preset) && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem
                    value="clear attachments"
                    onSelect={clearAttachments}
                  >
                    <X className="opacity-50" />
                    <span>Clear all attachments</span>
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function EmptyHint({ href, label }: { href: string; label: string }) {
  return (
    <div className="px-2 py-1.5 text-[11px] text-muted-foreground">
      {label}.{" "}
      <Link href={href} className="underline underline-offset-2">
        Open {href}
      </Link>
    </div>
  );
}
