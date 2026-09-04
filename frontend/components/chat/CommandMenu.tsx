"use client";

import {
  Bot,
  Check,
  ChevronRight,
  Layers,
  Plug,
  RotateCcw,
  Search,
  Sparkles,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { useChatPreset } from "@/components/chat/ChatPresetProvider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { isPresetEmpty } from "@/lib/chat-preset";
import { groupPresentation } from "@/lib/tool-groups";
import {
  describeToolCounts,
  enabledCount,
  isToolEnabled,
  selectableGroups,
  serverNameFromGroup,
  type SelectableGroup,
} from "@/lib/tool-selection";
import { cn } from "@/lib/utils";
import type { ToolInfo } from "@/lib/workflow-api";

/**
 * Everything the composer can attach or allow, behind one "/" button.
 *
 * This replaces four separate pills — "+", the agent switcher, Tools and the
 * MCP list — because they were four flat lists answering the same question
 * ("what does this turn have access to?") in four different shapes. The
 * composer row now carries only the two things that are genuinely per-message
 * settings: the mode and the model.
 *
 * A left rail keeps the categories separate rather than merging them into one
 * ranked list: an agent is a single choice, skills and servers are a set, and
 * tools are a permission grid — a flat command list has to pretend all three
 * are the same interaction. The search box filters across whichever categories
 * are on screen, so "git" still finds the tool group and the MCP server in one
 * keystroke.
 */

type Category = "all" | "agents" | "skills" | "tools" | "mcp";

const CATEGORIES: { id: Category; label: string; icon: LucideIcon }[] = [
  { id: "all", label: "Everything", icon: Layers },
  { id: "agents", label: "Agents", icon: Bot },
  { id: "skills", label: "Skills", icon: Sparkles },
  { id: "tools", label: "Tools", icon: Wrench },
  { id: "mcp", label: "MCP servers", icon: Plug },
];

/** Case-insensitive "do any of these fields contain the needle". */
function hit(needle: string, ...fields: (string | null | undefined)[]): boolean {
  if (!needle) return true;
  return fields.some((field) => (field ?? "").toLowerCase().includes(needle));
}

export default function CommandMenu() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category>("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const {
    preset,
    catalog,
    setAgent,
    attachSkill,
    detachSkill,
    toggleTool,
    toggleToolGroup,
    resetTools,
    toggleMcp,
    clearAttachments,
  } = useChatPreset();

  const needle = query.trim().toLowerCase();

  // Chat mode offers the model no tools at all, so every tool control below is
  // inert and says so rather than pretending the allowlist still means anything.
  const toolsOff = preset.mode === "chat";

  const agents = catalog.agents.filter((agent) =>
    hit(needle, agent.name, agent.slug, agent.description),
  );
  const skills = catalog.skills.filter((skill) =>
    hit(needle, skill.name, skill.slug, skill.description),
  );
  const servers = catalog.mcp.filter((server) =>
    hit(needle, server.name, server.description, server.transport),
  );

  // Groups are always computed from the *whole* catalog so the counts and the
  // switch state describe the real group, not the search result. Searching only
  // narrows which groups are listed and which tools show inside them.
  const allGroups = selectableGroups(catalog.tools, preset.toolNames);
  const groups = allGroups
    .map((group) => ({
      group,
      // A group whose own name matches keeps all of its tools visible.
      visible: hit(needle, group.name)
        ? group.tools
        : group.tools.filter((tool) => hit(needle, tool.name, tool.description)),
    }))
    .filter((entry) => entry.visible.length > 0);

  const toolHits = needle
    ? groups.reduce((sum, entry) => sum + entry.visible.length, 0)
    : catalog.tools.length;

  const counts: Record<Category, number> = {
    all: agents.length + skills.length + toolHits + servers.length,
    agents: agents.length,
    skills: skills.length,
    tools: toolHits,
    mcp: servers.length,
  };

  const show = (id: Exclude<Category, "all">) =>
    category === "all" || category === id;

  const nothing =
    (!show("agents") || agents.length === 0) &&
    (!show("skills") || skills.length === 0) &&
    (!show("tools") || groups.length === 0) &&
    (!show("mcp") || servers.length === 0);

  // A search that found nothing needs one message; an empty registry needs the
  // per-section hints below, which say where to go and create something.
  const blank = nothing && (catalog.loading || needle !== "");

  const narrowed = preset.toolNames !== null;
  const attached = !isPresetEmpty(preset);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Reset on open, not on close, so the panel does not visibly rearrange
        // itself while it animates away.
        if (next) {
          setQuery("");
          setCategory("all");
          setExpanded(null);
        }
      }}
    >
      {/*
        The dot sits outside the button so the button can carry one opacity for
        both its border and its glyph — that is what makes the box read as part
        of the same mark rather than a control drawn around it — while the
        "something is attached" dot stays at full strength.
      */}
      <span className="relative inline-flex shrink-0">
        <DialogTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 rounded-lg border border-current opacity-60 transition-opacity hover:opacity-100"
            aria-label="Agents, skills, tools and MCP servers"
            title="Agents, skills, tools and MCP servers"
          >
            {/*
              The typeface's own slash, not lucide's — that icon is a full 45°
              diagonal corner to corner, which reads as a "no entry" stroke
              rather than the key you press. Mono, so it matches the <kbd> in
              the panel's footer.
            */}
            <span aria-hidden className="font-mono text-[15px] leading-none">
              /
            </span>
          </Button>
        </DialogTrigger>

        {(attached || narrowed) && (
          <span
            aria-hidden
            className="pointer-events-none absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-primary"
          />
        )}
      </span>

      <DialogContent className="flex h-[36rem] w-[60rem] max-w-[92vw] flex-col overflow-hidden p-0">
        <DialogTitle className="sr-only">
          Agents, skills, tools and MCP servers
        </DialogTitle>
        <div className="relative shrink-0 border-b">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search agents, skills, tools and servers…"
            className="h-10 rounded-none border-0 pr-10 pl-9 shadow-none focus-visible:ring-0"
          />
        </div>

        <div className="flex min-h-0 flex-1">
          <nav
            aria-label="Categories"
            className="flex w-40 shrink-0 flex-col gap-0.5 overflow-y-auto border-r p-1.5"
          >
            {CATEGORIES.map((entry) => {
              const Icon = entry.icon;
              const active = entry.id === category;
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setCategory(entry.id)}
                  aria-pressed={active}
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors",
                    active ? "bg-accent font-medium" : "hover:bg-accent/60",
                    counts[entry.id] === 0 && !active && "opacity-50",
                  )}
                >
                  <Icon className="size-3.5 shrink-0 opacity-70" />
                  <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {catalog.loading ? "…" : counts[entry.id]}
                  </span>
                </button>
              );
            })}
          </nav>

          <ScrollArea className="h-full flex-1">
            {/* Keyed by category so switching tabs remounts this pane and
                re-triggers the fade — a plain class change wouldn't animate
                since the content underneath is also changing. */}
            <div key={category} className="animate-in fade-in-0 p-1.5 duration-150">
              {blank && (
                <p className="px-2 py-12 text-center text-xs text-muted-foreground">
                  {catalog.loading
                    ? "Loading the catalog…"
                    : `Nothing matches “${query.trim()}”.`}
                </p>
              )}

              {show("agents") && agents.length > 0 && (
                <section>
                  <Heading
                    icon={Bot}
                    label="Agents"
                    count={agents.length}
                    hint="one at a time"
                    href="/agents"
                  />

                  {/* Only offered unfiltered: it is a reset, not a search result. */}
                  {!needle && (
                    <Row
                      icon={Bot}
                      title="No agent"
                      meta="default prompt"
                      selected={!preset.agent}
                      onSelect={() => void setAgent(null)}
                    />
                  )}

                  {agents.map((agent) => (
                    <Row
                      key={agent.id}
                      icon={Bot}
                      title={agent.name}
                      meta={agent.model ?? agent.slug}
                      description={agent.description}
                      badge={agent.enabled ? null : "disabled"}
                      disabled={!agent.enabled}
                      selected={preset.agent?.id === agent.id}
                      onSelect={() => void setAgent(agent)}
                    />
                  ))}
                </section>
              )}

              {show("skills") && skills.length > 0 && (
                <section>
                  <Heading
                    icon={Sparkles}
                    label="Skills"
                    count={skills.length}
                    href="/skills"
                  />

                  {skills.map((skill) => {
                    const on = preset.skills.some((s) => s.id === skill.id);
                    return (
                      <Row
                        key={skill.id}
                        icon={Sparkles}
                        title={skill.name}
                        meta={skill.slug}
                        description={skill.description}
                        selected={on}
                        onSelect={() =>
                          on ? detachSkill(skill.id) : void attachSkill(skill)
                        }
                      />
                    );
                  })}
                </section>
              )}

              {show("tools") && groups.length > 0 && (
                <section>
                  <Heading
                    icon={Wrench}
                    label="Tools"
                    count={
                      toolsOff ? 0 : enabledCount(catalog.tools, preset.toolNames)
                    }
                    hint={describeToolCounts(catalog.tools)}
                    href="/tools"
                  />

                  {toolsOff && (
                    <p className="mx-1 mb-1 rounded-lg bg-muted/50 px-2 py-1.5 text-[11px] text-muted-foreground">
                      Chat mode offers the model no tools. Switch to Auto or
                      Manual to use these.
                    </p>
                  )}

                  {groups.map(({ group, visible }) => (
                    <GroupRow
                      key={group.name}
                      group={group}
                      tools={visible}
                      disabled={toolsOff}
                      // While searching, the matching tools are the answer —
                      // collapsing them would hide what was found.
                      expanded={needle !== "" || expanded === group.name}
                      onExpand={() =>
                        setExpanded((prev) =>
                          prev === group.name ? null : group.name,
                        )
                      }
                      onToggleGroup={() => toggleToolGroup(group)}
                      onToggleTool={toggleTool}
                      toolNames={preset.toolNames}
                    />
                  ))}
                </section>
              )}

              {show("mcp") && servers.length > 0 && (
                <section>
                  <Heading
                    icon={Plug}
                    label="MCP servers"
                    count={servers.length}
                    href="/mcp"
                  />

                  {servers.map((server) => {
                    const on = preset.mcpServers.some((s) => s.id === server.id);
                    // Tool counts only exist once a server is attached, since
                    // discovery costs a round trip to each one.
                    const discovered = allGroups.find(
                      (group) => serverNameFromGroup(group.name) === server.name,
                    );
                    return (
                      <Row
                        key={server.id}
                        icon={Plug}
                        title={server.name}
                        meta={server.transport}
                        description={server.description}
                        badge={
                          on
                            ? discovered
                              ? `${discovered.enabled}/${discovered.tools.length} tools`
                              : "connecting…"
                            : null
                        }
                        selected={on}
                        onSelect={() => toggleMcp(server)}
                      />
                    );
                  })}

                  {catalog.mcpNotices.map((notice) => (
                    <p
                      key={notice}
                      className="px-2 py-1 text-[11px] text-amber-600 dark:text-amber-400"
                    >
                      {notice}
                    </p>
                  ))}
                </section>
              )}

              {!needle && !catalog.loading && (
                <>
                  {show("agents") && agents.length === 0 && (
                    <EmptyHint href="/agents" label="No agents yet — create one" />
                  )}
                  {show("skills") && skills.length === 0 && (
                    <EmptyHint href="/skills" label="No skills yet — write one" />
                  )}
                  {show("tools") && groups.length === 0 && (
                    <p className="px-2 py-1.5 text-[11px] text-muted-foreground">
                      No tools reported. Check that the Python harness is running.
                    </p>
                  )}
                  {show("mcp") && servers.length === 0 && (
                    <EmptyHint href="/mcp" label="No MCP servers configured" />
                  )}
                </>
              )}
            </div>
          </ScrollArea>
        </div>

        <footer className="flex shrink-0 items-center gap-3 border-t px-3 py-2 text-[11px] text-muted-foreground">
          {/* The shortcuts the composer no longer spends a row of chrome on. */}
          <span className="min-w-0 truncate">
            <kbd className="font-mono">/</kbd> attaches by name ·{" "}
            <kbd className="font-mono">⏎</kbd> send ·{" "}
            <kbd className="font-mono">⇧⏎</kbd> newline
          </span>

          <span className="ml-auto flex shrink-0 items-center gap-1">
            {narrowed && !toolsOff && (
              <FooterAction
                icon={RotateCcw}
                label="All tools"
                onClick={resetTools}
              />
            )}
            {attached && (
              <FooterAction icon={X} label="Clear" onClick={clearAttachments} />
            )}
          </span>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

function Heading({
  icon: Icon,
  label,
  count,
  hint,
  href,
}: {
  icon: LucideIcon;
  label: string;
  count: number;
  hint?: string;
  href: string;
}) {
  return (
    <div className="flex items-baseline gap-2 px-2 pt-2 pb-1">
      <Icon className="size-3.5 shrink-0 self-center opacity-60" />
      <span className="text-[11px] font-medium tracking-wide uppercase">
        {label}
      </span>
      <span className="font-mono text-[10px] text-muted-foreground">{count}</span>
      {hint && (
        <span className="truncate text-[10px] text-muted-foreground">{hint}</span>
      )}
      <Link
        href={href}
        className="ml-auto shrink-0 text-[10px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
      >
        manage
      </Link>
    </div>
  );
}

function Row({
  icon: Icon,
  title,
  meta,
  description,
  badge,
  disabled,
  selected,
  onSelect,
}: {
  icon: LucideIcon;
  title: string;
  meta?: string | null;
  description?: string | null;
  badge?: string | null;
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
      <Icon className="mt-0.5 size-3.5 shrink-0 opacity-70" />

      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-1.5">
          <span className="truncate text-xs font-medium">{title}</span>
          {meta && (
            <span className="shrink-0 truncate font-mono text-[10px] text-muted-foreground">
              {meta}
            </span>
          )}
          {badge && (
            <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">
              {badge}
            </span>
          )}
        </span>
        {description && (
          <span className="line-clamp-1 text-[10.5px] text-muted-foreground">
            {description}
          </span>
        )}
      </span>

      {selected && (
        <Check className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
      )}
    </button>
  );
}

/**
 * One tool group: a switch for the whole group, with the individual tools one
 * click away. The useful question is almost always "may it touch files at all",
 * not "may it call list_directory specifically".
 */
function GroupRow({
  group,
  tools,
  disabled,
  expanded,
  onExpand,
  onToggleGroup,
  onToggleTool,
  toolNames,
}: {
  group: SelectableGroup;
  /** What to list when expanded — the search result, or the whole group. */
  tools: ToolInfo[];
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
            className={cn(
              "size-3.5 shrink-0 opacity-50 transition-transform",
              expanded && "rotate-90",
            )}
          />
          <Icon className="size-3.5 shrink-0 opacity-70" />
          <span className="truncate text-xs font-medium">{group.name}</span>
          <span className="ml-auto pr-1 font-mono text-[10px] text-muted-foreground">
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
          {tools.map((tool) => (
            <li key={tool.name}>
              <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 transition-colors hover:bg-accent">
                <input
                  type="checkbox"
                  checked={isToolEnabled(tool.name, toolNames)}
                  disabled={disabled}
                  onChange={() => onToggleTool(tool.name)}
                  className="size-3.5 accent-primary"
                />
                <span className="truncate font-mono text-[11px]">{tool.name}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FooterAction({
  icon: Icon,
  label,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 rounded-md px-1.5 py-1 transition-colors hover:bg-accent hover:text-foreground"
    >
      <Icon className="size-3" />
      {label}
    </button>
  );
}

function EmptyHint({ href, label }: { href: string; label: string }) {
  return (
    <p className="px-2 py-1.5 text-[11px] text-muted-foreground">
      {label}.{" "}
      <Link href={href} className="underline underline-offset-2">
        Open {href}
      </Link>
    </p>
  );
}
