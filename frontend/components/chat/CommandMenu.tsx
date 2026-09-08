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
  type DisabledTools,
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
  const allGroups = selectableGroups(
    catalog.tools,
    preset.toolNames,
    catalog.disabledTools,
  );

  // How many of the tools on screen are switched off for everyone. Counted from
  // the catalog rather than from disabledTools.size, which also holds names for
  // servers that are not attached right now and tools this harness no longer has.
  const offHere = catalog.tools.filter((tool) =>
    catalog.disabledTools.has(tool.name),
  ).length;
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

      <DialogContent className="flex h-[36rem] w-[60rem] max-w-[92vw] flex-col overflow-hidden p-0 sm:max-w-[92vw]">
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
                    {/* Tools are also unsettled while MCP discovery runs: the
                        count would tick down and back up as mcp__* tools are
                        swapped out and in. */}
                    {catalog.loading ||
                    (entry.id === "tools" && catalog.mcpToolsLoading)
                      ? "…"
                      : counts[entry.id]}
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
                      toolsOff
                        ? 0
                        : enabledCount(
                            catalog.tools,
                            preset.toolNames,
                            catalog.disabledTools,
                          )
                    }
                    hint={describeToolCounts(catalog.tools, catalog.disabledTools)}
                    href="/tools"
                  />

                  {toolsOff && (
                    <p className="mx-1 mb-1 rounded-lg bg-muted/50 px-2 py-1.5 text-[11px] text-muted-foreground">
                      Chat mode offers the model no tools. Switch to Auto or
                      Manual to use these.
                    </p>
                  )}

                  {/* The other reason a switch here can be inert, and the one
                      that is not about this turn at all. The heading already
                      links to /tools, so this does not repeat the link. */}
                  {!toolsOff && offHere > 0 && (
                    <p className="mx-1 mb-1 rounded-lg bg-muted/50 px-2 py-1.5 text-[11px] text-muted-foreground">
                      {offHere} {offHere === 1 ? "tool is" : "tools are"} switched
                      off for everyone on the Tools page, and cannot be enabled
                      here.
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
                      disabledTools={catalog.disabledTools}
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

                  {toolsOff && preset.mcpServers.length > 0 && (
                    <p className="px-2 py-1 text-[11px] text-muted-foreground">
                      Chat mode does not use tools — attached servers are
                      ignored until you switch to Agent or Manual.
                    </p>
                  )}

                  {servers.map((server) => {
                    const on = preset.mcpServers.some((s) => s.id === server.id);
                    // Tool counts only exist once a server is attached, since
                    // discovery costs a round trip to each one.
                    const discovered = allGroups.find(
                      (group) => serverNameFromGroup(group.name) === server.name,
                    );
                    // Matched by id, not by looking for the server's quoted name
                    // in the message: names that were substrings of one another
                    // cross-matched, and some notices name no server at all. The
                    // name fallback covers a backend older than server_notices.
                    const failure =
                      catalog.mcpServerNotices.find(
                        (notice) => notice.server_id === server.id,
                      )?.message ??
                      (catalog.mcpServerNotices.length === 0
                        ? catalog.mcpNotices.find((notice) =>
                            notice.includes(`'${server.name}'`),
                          )
                        : undefined);
                    const badge = !on
                      ? null
                      : discovered
                        ? `${discovered.enabled}/${discovered.tools.length} tools`
                        : failure
                          ? "failed"
                          : catalog.mcpToolsLoading
                            ? "connecting…"
                            : "failed";
                    return (
                      <Row
                        key={server.id}
                        icon={Plug}
                        title={server.name}
                        meta={server.transport}
                        description={server.description}
                        badge={badge}
                        badgeTone={badge === "failed" ? "error" : "neutral"}
                        badgeTitle={failure}
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
                      {/* Discovery empties the tool list while it runs, and
                          telling someone to go check a healthy backend is worse
                          than saying nothing. */}
                      {catalog.mcpToolsLoading
                        ? "Discovering tools…"
                        : "No tools reported. Check that the Python harness is running."}
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
  badgeTitle,
  badgeTone = "neutral",
  disabled,
  selected,
  onSelect,
}: {
  icon: LucideIcon;
  title: string;
  meta?: string | null;
  description?: string | null;
  badge?: string | null;
  /** Shown as a native tooltip — the full failure reason doesn't fit inline. */
  badgeTitle?: string;
  badgeTone?: "neutral" | "error";
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
            <span
              title={badgeTitle}
              className={cn(
                "shrink-0 rounded px-1 text-[10px]",
                badgeTone === "error"
                  ? "bg-red-500/15 text-red-600 dark:text-red-400"
                  : "bg-muted text-muted-foreground",
              )}
            >
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
 *
 * Every control here is a Switch, including the per-tool ones. They were
 * checkboxes, which made a nested list of permissions read as a form to submit
 * rather than a set of things already on or off — and put two different control
 * languages one indent apart.
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
  disabledTools,
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
  /** Switched off globally on /tools: shown, struck through, and not toggleable. */
  disabledTools: DisabledTools;
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
          disabled={disabled || group.locked}
          onCheckedChange={onToggleGroup}
          aria-label={`Toggle ${group.name}`}
          title={
            group.locked
              ? "Every tool in this group is switched off on the Tools page."
              : undefined
          }
          // A partly-on group reads as on but dimmed, so the switch never
          // claims a state the count contradicts.
          className={group.state === "partial" ? "opacity-60" : ""}
        />
      </div>

      {expanded && (
        // A stepper rail rather than a plain indent: an expanded group drops a
        // flat list into a flat list, and there was nothing in the margin to
        // say where the group's tools ended and the next group began. The rail
        // is drawn on the <ul> and stops at its last child, so it reads as the
        // group's own extent.
        //
        // The line runs THROUGH the nodes rather than branching into them —
        // these are the members of one thing, not children hanging off it.
        <ul className="relative ml-[1.375rem] pb-1 pl-5 before:absolute before:top-3 before:bottom-3 before:left-0 before:w-px before:bg-border before:content-['']">
          {tools.map((tool) => {
            const locked = disabledTools.has(tool.name);
            const on = isToolEnabled(tool.name, toolNames, disabledTools);
            return (
              <li key={tool.name}>
                {/* Name first, switch pushed right, so the row echoes the group
                    row above rather than mirroring it. Scaled down because the
                    kit's Switch has one size and a nested control that matches
                    its parent's weight stops reading as nested. */}
                <label
                  className={cn(
                    "group/tool relative flex items-center gap-2 rounded px-2 py-1 transition-colors",
                    disabled || locked
                      ? "cursor-default"
                      : "cursor-pointer hover:bg-accent",
                  )}
                  title={
                    locked
                      ? `${tool.name} is switched off for everyone on the Tools page.`
                      : undefined
                  }
                >
                  <StepNode on={on} />
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate font-mono text-[11px] transition-colors",
                      locked && "text-muted-foreground line-through",
                      !on && !locked && "text-muted-foreground",
                    )}
                  >
                    {tool.name}
                  </span>
                  <Switch
                    checked={on}
                    disabled={disabled || locked}
                    onCheckedChange={() => onToggleTool(tool.name)}
                    aria-label={`Toggle ${tool.name}`}
                    className="scale-75"
                  />
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * One node on the group's rail.
 *
 * Sits ON the line — absolutely positioned back over the <ul>'s border, with
 * the page background ringed around it so the line appears to pass behind
 * rather than through.
 *
 * The halo carries the state. A tool that is on gets a filled node and a soft
 * ring; one that is off is hollow and unlit. That makes the rail readable at a
 * glance from the margin, which a column of identical dots beside a column of
 * switches would not be — the switch still says it precisely, and this says it
 * peripherally.
 */
function StepNode({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      // -left-5 puts it back on the rail the <ul> draws at its own left edge,
      // undoing this row's pl-5.
      className="pointer-events-none absolute top-1/2 -left-5 flex size-3 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
    >
      {/* The glow. Scaled rather than resized so it animates smoothly, and it
          is the only part that carries colour when the tool is off. */}
      <span
        className={cn(
          "absolute size-3 rounded-full transition-all duration-200",
          on ? "scale-100 bg-primary/20" : "scale-50 bg-transparent",
        )}
      />
      <span
        className={cn(
          "relative size-1.5 rounded-full ring-2 ring-popover transition-colors duration-200",
          on ? "bg-primary" : "bg-muted-foreground/40",
        )}
      />
    </span>
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
