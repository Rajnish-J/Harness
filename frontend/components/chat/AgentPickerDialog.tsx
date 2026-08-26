"use client";

import { Bot, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { useChatPreset } from "@/components/chat/ChatPresetProvider";
import ResourceCard from "@/components/registry/ResourceCard";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { AgentSummary } from "@/lib/registry-types";

/**
 * Choosing who you are talking to.
 *
 * A modal with cards rather than another Popover + Command list: the composer
 * already carries four dropdowns (+, mode, tools, model) and the agent — which
 * swaps the system prompt and the whole tool surface — was the fifth, visually
 * indistinguishable from a filter. Cards also let the description carry its own
 * line, which is what makes two similar agents tellable apart.
 *
 * Deliberately not `Command`: reusing it is precisely what would make this a
 * fourth copy of the same control.
 */
export default function AgentPickerDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { preset, catalog, setAgent } = useChatPreset();
  const [query, setQuery] = useState("");

  // Reset through the open handler rather than an effect: this is an event, and
  // setState inside useEffect is a lint error in this repo.
  function handleOpenChange(next: boolean) {
    onOpenChange(next);
    if (next) setQuery("");
  }

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
    handleOpenChange(false);
  }

  const showNoAgent = !query.trim() || "no agent".includes(query.trim().toLowerCase());

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Choose an agent</DialogTitle>
          <DialogDescription>
            An agent sets the system prompt, the model, and the tools this turn
            may call.
          </DialogDescription>
        </DialogHeader>

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

        <div className="max-h-[55vh] overflow-y-auto">
          {matches.length === 0 && !showNoAgent ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Nothing matches “{query}”.
            </p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
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

        {catalog.agents.length === 0 && !catalog.loading && (
          <p className="text-[11px] text-muted-foreground">
            No agents yet.{" "}
            <Link href="/agents" className="underline underline-offset-2">
              Create one
            </Link>
          </p>
        )}
      </DialogContent>
    </Dialog>
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
      className="w-full rounded-xl text-left transition-colors hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <ResourceCard
        icon={Bot}
        tone="sky"
        title={title}
        kind={kind}
        meta={meta}
        disabled={disabled}
        selected={selected}
      />
    </button>
  );
}
