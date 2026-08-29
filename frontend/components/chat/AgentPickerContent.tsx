"use client";

import { Bot, Check, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { useChatPreset } from "@/components/chat/ChatPresetProvider";
import { Input } from "@/components/ui/input";
import { PopoverContent } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { AgentSummary } from "@/lib/registry-types";

/**
 * The agent picker's popover body: search box + card list.
 *
 * Split from AgentSwitcher, which owns the trigger and open state, so this
 * carries the filtering logic and the card list — same shape as ModelPicker
 * and ToolsPopover. AgentSwitcher remounts this (via a key) each time it
 * opens, which is what resets the search query instead of an effect.
 */
export default function AgentPickerContent({
  onClose,
}: {
  onClose: () => void;
}) {
  const { preset, catalog, setAgent } = useChatPreset();
  const [query, setQuery] = useState("");

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return catalog.agents;
    return catalog.agents.filter((agent) =>
      [agent.name, agent.slug, agent.description ?? ""].some((field) =>
        field.toLowerCase().includes(needle),
      ),
    );
  }, [catalog.agents, query]);

  function choose(agent: AgentSummary | null) {
    void setAgent(agent);
    onClose();
  }

  const showNoAgent =
    !query.trim() || "no agent".includes(query.trim().toLowerCase());

  return (
    <PopoverContent
      align="start"
      side="bottom"
      className="w-72 overflow-hidden p-0"
    >
      <div className="border-b p-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search agents…"
            className="pl-8"
          />
        </div>
      </div>

      <ScrollArea className="max-h-72">
        <div className="p-1">
          {matches.length === 0 && !showNoAgent ? (
            <p className="py-8 text-center text-xs text-muted-foreground">
              Nothing matches “{query}”.
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {showNoAgent && (
                <li>
                  <PickerCard
                    title="No agent"
                    kind="Default"
                    meta="The default harness prompt."
                    selected={!preset.agent}
                    onSelect={() => choose(null)}
                  />
                </li>
              )}

              {matches.map((agent) => (
                <li key={agent.id}>
                  <PickerCard
                    title={agent.name}
                    kind={agent.model ?? agent.slug}
                    meta={agent.description}
                    disabled={!agent.enabled}
                    selected={preset.agent?.id === agent.id}
                    onSelect={() => choose(agent)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </ScrollArea>

      {catalog.agents.length === 0 && !catalog.loading && (
        <p className="border-t px-3 py-2 text-[11px] text-muted-foreground">
          No agents yet.{" "}
          <Link href="/agents" className="underline underline-offset-2">
            Create one
          </Link>
        </p>
      )}
    </PopoverContent>
  );
}

function PickerCard({
  title,
  kind,
  meta,
  disabled,
  selected,
  onSelect,
}: {
  title: string;
  kind?: string | null;
  meta?: string | null;
  disabled?: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      disabled={disabled}
      className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-45"
    >
      <div className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-400">
        <Bot className="size-3.5" aria-hidden />
      </div>

      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-xs font-medium">
          <span className="truncate">{title}</span>
          {disabled && (
            <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] font-normal text-muted-foreground">
              disabled
            </span>
          )}
        </p>
        {kind && (
          <p className="truncate text-[10.5px] text-muted-foreground">
            {kind}
          </p>
        )}
        {meta && (
          <p className="line-clamp-1 text-[10.5px] text-muted-foreground">
            {meta}
          </p>
        )}
      </div>

      {selected && (
        <Check className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
      )}
    </button>
  );
}
