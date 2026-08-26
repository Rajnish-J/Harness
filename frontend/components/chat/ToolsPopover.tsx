"use client";

import { ChevronRight, Plug, RotateCcw, Wrench } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { useChatPreset } from "@/components/chat/ChatPresetProvider";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { groupPresentation } from "@/lib/tool-groups";
import {
  describeToolCounts,
  enabledCount,
  isToolEnabled,
  selectableGroups,
  serverNameFromGroup,
  type SelectableGroup,
} from "@/lib/tool-selection";

/**
 * What this turn may call, grouped the way the harness groups it.
 *
 * A group switch is the primary control and a per-tool list is one click away,
 * because the useful question is almost always "may it touch files at all",
 * not "may it call list_directory specifically".
 */
export default function ToolsPopover() {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const { preset, catalog, toggleTool, toggleToolGroup, resetTools } =
    useChatPreset();

  const groups = selectableGroups(catalog.tools, preset.toolNames);
  const active = enabledCount(catalog.tools, preset.toolNames);

  // Chat mode sends no tools at all, so the count would be a lie.
  const disabled = preset.mode === "chat";
  // Before the catalog lands, "0" would read as "no tools available" rather
  // than "not known yet".
  const count = catalog.loading ? "…" : disabled ? 0 : active;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 rounded-full px-2.5 text-xs font-normal"
          aria-label={`Tools: ${
            catalog.loading
              ? "loading"
              : disabled
                ? "none in chat mode"
                : `${active} enabled`
          }`}
        >
          <Wrench className="size-3.5 opacity-70" />
          Tools
          <span className="text-muted-foreground">|</span>
          <span className={disabled ? "text-muted-foreground line-through" : ""}>
            {count}
          </span>
        </Button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-96 p-0">
        <header className="flex items-baseline justify-between border-b px-3 py-2.5">
          <span className="text-sm font-medium">Tools</span>
          <span className="text-[11px] text-muted-foreground">
            {describeToolCounts(catalog.tools)}
          </span>
        </header>

        {disabled && (
          <p className="border-b bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
            Chat mode offers the model no tools. Switch to Agent or Manual to
            use these.
          </p>
        )}

        <div className="max-h-80 overflow-y-auto p-1.5">
          {groups.length === 0 && (
            <p className="px-2 py-6 text-center text-[11px] text-muted-foreground">
              {catalog.loading
                ? "Loading tools…"
                : "No tools reported. Check that the Python harness is running."}
            </p>
          )}

          {groups.map((group) => (
            <GroupRow
              key={group.name}
              group={group}
              disabled={disabled}
              expanded={expanded === group.name}
              onExpand={() =>
                setExpanded((prev) => (prev === group.name ? null : group.name))
              }
              onToggleGroup={() => toggleToolGroup(group)}
              onToggleTool={toggleTool}
              toolNames={preset.toolNames}
            />
          ))}
        </div>

        <section className="border-t px-3 py-2.5">
          <p className="pb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            MCP servers
          </p>

          {preset.mcpServers.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">
              None attached. Add one from the{" "}
              <span className="font-medium">+</span> menu, or configure servers
              on{" "}
              <Link href="/mcp" className="underline underline-offset-2">
                /mcp
              </Link>
              .
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {preset.mcpServers.map((server) => {
                const tools = groups.find(
                  (group) => serverNameFromGroup(group.name) === server.name,
                );
                return (
                  <li
                    key={server.id}
                    className="flex items-center gap-2 text-xs"
                  >
                    <Plug className="size-3.5 shrink-0 opacity-60" />
                    <span className="truncate">{server.name}</span>
                    <span className="ml-auto text-[11px] text-muted-foreground">
                      {tools ? `${tools.enabled}/${tools.tools.length}` : "…"}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          {catalog.mcpNotices.map((notice) => (
            <p
              key={notice}
              className="mt-1.5 text-[11px] text-amber-600 dark:text-amber-400"
            >
              {notice}
            </p>
          ))}
        </section>

        {preset.toolNames !== null && !disabled && (
          <footer className="border-t p-1.5">
            <button
              type="button"
              onClick={resetTools}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition-colors hover:bg-accent"
            >
              <RotateCcw className="size-3.5 opacity-60" />
              Use every available tool
            </button>
          </footer>
        )}
      </PopoverContent>
    </Popover>
  );
}

function GroupRow({
  group,
  disabled,
  expanded,
  onExpand,
  onToggleGroup,
  onToggleTool,
  toolNames,
}: {
  group: SelectableGroup;
  disabled: boolean;
  expanded: boolean;
  onExpand: () => void;
  onToggleGroup: () => void;
  onToggleTool: (name: string) => void;
  toolNames: string[] | null;
}) {
  const { icon: Icon } = groupPresentation(group.name);

  return (
    <div>
      <div className="flex items-center gap-2 rounded-lg px-2 py-1.5">
        <button
          type="button"
          onClick={onExpand}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <ChevronRight
            className={`size-3.5 shrink-0 opacity-50 transition-transform ${
              expanded ? "rotate-90" : ""
            }`}
          />
          <Icon className="size-4 shrink-0 opacity-70" />
          <span className="truncate text-sm">{group.name}</span>
          <span className="ml-auto pr-1 font-mono text-[11px] text-muted-foreground">
            {group.enabled}/{group.tools.length}
          </span>
        </button>

        <Switch
          checked={group.state !== "off"}
          disabled={disabled}
          onCheckedChange={onToggleGroup}
          aria-label={`Toggle ${group.name}`}
          // A partly-on group reads as on but dimmed, so the switch never
          // claims a state the count contradicts.
          className={group.state === "partial" ? "opacity-60" : ""}
        />
      </div>

      {expanded && (
        <ul className="pb-1 pl-9">
          {group.tools.map((tool) => (
            <li key={tool.name}>
              <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 transition-colors hover:bg-accent">
                <input
                  type="checkbox"
                  checked={isToolEnabled(tool.name, toolNames)}
                  disabled={disabled}
                  onChange={() => onToggleTool(tool.name)}
                  className="size-3.5 accent-primary"
                />
                <span className="truncate font-mono text-[11px]">
                  {tool.name}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
