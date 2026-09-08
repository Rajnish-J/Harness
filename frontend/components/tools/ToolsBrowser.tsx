"use client";

import { Plug, Search, Wrench } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useChatPreset } from "@/components/chat/ChatPresetProvider";
import EmptyState from "@/components/registry/EmptyState";
import ResourceCard from "@/components/registry/ResourceCard";
import SectionHeader from "@/components/registry/SectionHeader";
import {
  SkeletonCardGrid,
  SkeletonSectionHeader,
} from "@/components/registry/Skeletons";
import ToolGroupDialog from "@/components/tools/ToolGroupDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { mcpApi } from "@/lib/registry-api";
import type { McpServerSummary } from "@/lib/registry-types";
import {
  MCP_GROUP_PREFIX,
  groupPresentation,
  groupTools,
  toolGroupName,
  type ToolGroup,
} from "@/lib/tool-groups";
import {
  fetchToolSettings,
  setToolsEnabled,
} from "@/lib/tool-settings-api";
import {
  fetchMcpTools,
  fetchTools,
  type ToolInfo,
} from "@/lib/workflow-api";
import { cn } from "@/lib/utils";

/**
 * The harness's tool registry, and the one place a tool is turned off for good.
 *
 * Fetched in the browser for the same reason the sidebar's config line is:
 * API_BASE is the harness as the *browser* sees it, and a server-side fetch
 * would block the page render on Python being up. fetchTools already returns
 * [] rather than throwing when the harness is unreachable.
 *
 * The grouping is the backend's — `Tool.group` — so a new section in Python
 * shows up here without a frontend edit. Built-ins and MCP-discovered tools are
 * split into two sections because they are managed in different places: the
 * former in the harness, the latter on /mcp.
 *
 * The MCP section is driven by the *server list*, not by the discovered tools,
 * and joined to them by the `MCP · {name}` group convention. Deriving it from
 * tools alone made a configured server that could not connect simply vanish
 * from the page — which is the exact moment someone comes looking for it. A
 * server with no tools is now visible and says why.
 *
 * What changed when this page became the source of truth: the switches write to
 * tool_settings, and the harness subtracts that list from every turn. Adding
 * and configuring MCP servers still lives on /mcp — this page reports on them
 * and governs which of their tools may be spent.
 */

/** The tool group a server's tools land in. Mirrors mcp_group() in Python. */
function groupNameFor(server: { name: string }): string {
  return `${MCP_GROUP_PREFIX}${server.name}`;
}

export default function ToolsBrowser() {
  const [tools, setTools] = useState<ToolInfo[] | null>(null);
  const [servers, setServers] = useState<McpServerSummary[] | null>(null);
  // null until discovery answers, which is what separates "still asking" from
  // "asked, and this server offers nothing".
  const [discovered, setDiscovered] = useState<{
    tools: ToolInfo[];
    notices: string[];
  } | null>(null);
  // null until the disable list lands, so the page never renders a tool as on
  // before it knows whether it is.
  const [disabled, setDisabled] = useState<string[] | null>(null);
  // Names with a write in flight. The switch holds still rather than flicking
  // back and forth while the round trip runs.
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  // Disabled servers the operator has asked to dial. Discovery is a live
  // connection — for a stdio server, a spawned process — so a server that is
  // switched off is not contacted until someone asks for it by name.
  const [previewIds, setPreviewIds] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState("");
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  // The composer holds the same list, and would otherwise keep showing tools as
  // available until a full reload.
  const { refetchToolSettings } = useChatPreset();

  useEffect(() => {
    const controller = new AbortController();
    fetchTools(controller.signal).then(setTools);
    // Separate origins: tools come from the Python harness, servers and the
    // disable list from this app's own routes. Any can be down without blanking
    // the others, so a failed server list just leaves the MCP section empty.
    mcpApi.list().then(setServers).catch(() => setServers([]));
    fetchToolSettings(controller.signal).then(({ disabled: off }) =>
      setDisabled(off),
    );
    return () => controller.abort();
  }, []);

  const disabledSet = useMemo(() => new Set(disabled ?? []), [disabled]);

  // Discovery is a second round trip, made per server, and it is the only way
  // this page can know a server's tools: GET /api/workflows/tools returns the
  // built-in registry alone and never contains an mcp__* tool, so counting them
  // out of `tools` would report zero for every server forever.
  //
  // Enabled servers are dialled automatically; disabled ones only once asked
  // for, which is what keeps opening this page from spawning processes for
  // servers deliberately switched off.
  const discoverIds = (servers ?? [])
    .filter((server) => server.enabled || previewIds.has(server.id))
    .map((server) => server.id)
    .join(",");

  useEffect(() => {
    if (servers === null) return;
    const controller = new AbortController();
    const ids = discoverIds ? discoverIds.split(",") : [];

    fetchMcpTools(ids, controller.signal, { includeDisabled: true })
      .then(({ tools: found, notices }) => {
        if (controller.signal.aborted) return;
        setDiscovered({ tools: found, notices });
      })
      .catch(() => {
        // fetchMcpTools swallows its own failures; this only catches an abort.
      });

    return () => controller.abort();
  }, [discoverIds, servers]);

  /**
   * Write a set of tools on or off.
   *
   * Optimistic, then reconciled against what the server reports rather than
   * against what we assumed: a concurrent change from another tab lands here
   * too. A rejection rolls the whole batch back and says why, because a switch
   * that silently springs back is worse than one that explains itself.
   */
  const setEnabled = useCallback(
    async (names: string[], enabled: boolean) => {
      if (names.length === 0) return;

      const previous = disabled ?? [];
      setError(null);
      setPending((prev) => new Set([...prev, ...names]));
      setDisabled(
        enabled
          ? previous.filter((name) => !names.includes(name))
          : [...new Set([...previous, ...names])].sort(),
      );

      try {
        const result = await setToolsEnabled(names, enabled);
        setDisabled(result.disabled);
        await refetchToolSettings();
      } catch (cause) {
        setDisabled(previous);
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not save that change.",
        );
      } finally {
        setPending((prev) => {
          const next = new Set(prev);
          for (const name of names) next.delete(name);
          return next;
        });
      }
    },
    [disabled, refetchToolSettings],
  );

  const groups = useMemo(() => {
    if (!tools) return [];
    // Built-ins from the harness plus whatever discovery turned up, grouped
    // together: `Tool.group` already namespaces MCP tools as `MCP · {server}`,
    // so the split below still separates them.
    const all = [...tools, ...(discovered?.tools ?? [])];
    const needle = query.trim().toLowerCase();
    const matching = needle
      ? all.filter(
          (tool) =>
            tool.name.toLowerCase().includes(needle) ||
            tool.description.toLowerCase().includes(needle),
        )
      : all;
    return groupTools(matching);
  }, [tools, discovered, query]);

  const builtin = groups.filter((g) => !g.name.startsWith(MCP_GROUP_PREFIX));

  // One card per configured server, carrying whatever tools it discovered.
  // Filtering by name as well as by tool means a search still narrows the list
  // when a server has connected nothing.
  const mcpServers = useMemo(() => {
    const byGroup = new Map(groups.map((group) => [group.name, group]));
    const needle = query.trim().toLowerCase();

    return (servers ?? [])
      .map((server) => ({
        server,
        tools: byGroup.get(groupNameFor(server))?.tools ?? [],
      }))
      .filter(
        ({ server, tools: found }) =>
          !needle ||
          found.length > 0 ||
          server.name.toLowerCase().includes(needle) ||
          (server.description ?? "").toLowerCase().includes(needle),
      );
  }, [servers, groups, query]);

  // Discovery has not answered yet, so no server can be called toolless.
  const discovering = discovered === null;

  // The dialog reads from the unfiltered set: narrowing the grid should not
  // hide tools inside a group the operator then opens.
  const openTools = useMemo(
    () =>
      [...(tools ?? []), ...(discovered?.tools ?? [])].filter(
        (tool) => toolGroupName(tool) === openGroup,
      ),
    [tools, discovered, openGroup],
  );

  // All three must land before the page can tell "nothing here" from "not asked
  // yet". They resolve independently, and whichever wins the race would
  // otherwise render its section's empty state as if it were the answer.
  if (tools === null || servers === null || disabled === null) {
    return (
      <div className="flex flex-col gap-8">
        <Skeleton className="h-9 w-full" />
        {[0, 1].map((section) => (
          <section key={section} className="flex flex-col gap-4">
            <SkeletonSectionHeader />
            <SkeletonCardGrid count={3} />
          </section>
        ))}
      </div>
    );
  }

  // Only a truly empty page short-circuits: a harness reporting no tools can
  // still have MCP servers configured, and hiding them here would send someone
  // to /mcp wondering where their server went.
  if (tools.length === 0 && servers.length === 0) {
    return (
      <EmptyState
        icon={Wrench}
        title="No tools reported"
        description="Tools are registered in the Python harness (backend/app/agent/tools/registry.py) — check that it is running."
      />
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Filter ${tools.length} tools`}
          className="pl-8"
        />
      </div>

      {error && (
        <p className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <section className="flex flex-col gap-4">
        <SectionHeader
          title="Built-in Tools"
          hint="Registered in the Python harness. A tool switched off here is withheld from every chat and agent turn."
        />
        <GroupGrid
          groups={builtin}
          query={query}
          disabled={disabledSet}
          pending={pending}
          onSetEnabled={setEnabled}
          onManage={setOpenGroup}
          emptyTitle="No built-in tools match"
        />
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeader
          title="MCP Tools"
          hint="One card per configured server. Their tools reach the agent namespaced mcp__{server}__{tool}. Add or manage servers on the MCP page."
          action={
            <Button variant="outline" size="sm" asChild>
              <Link href="/mcp">Manage servers</Link>
            </Button>
          }
        />
        {mcpServers.length === 0 ? (
          <EmptyState
            icon={Plug}
            title={query.trim() ? "No MCP servers match" : "No MCP servers connected"}
            description={
              query.trim()
                ? `Nothing matches “${query}”.`
                : "Add one from the catalog on the MCP page to extend the agent's tool surface."
            }
          />
        ) : (
          <>
          {/* Why a server came back with nothing. Amber, and above the grid,
              matching how the composer reports the same notices. */}
          {(discovered?.notices ?? []).map((notice) => (
            <p
              key={notice}
              className="text-xs text-amber-600 dark:text-amber-400"
            >
              {notice}
            </p>
          ))}
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {mcpServers.map(({ server, tools: found }) => {
              const asked = server.enabled || previewIds.has(server.id);
              const off = found.filter((tool) =>
                disabledSet.has(tool.name),
              ).length;
              return (
                <li key={server.id}>
                  <ResourceCard
                    icon={Plug}
                    tone="purple"
                    title={server.name}
                    kind={server.transport}
                    meta={
                      off > 0
                        ? `${found.length} tools · ${off} off`
                        : (server.description ?? server.url ?? server.command)
                    }
                    status={serverStatus(server, found.length, discovering, asked)}
                    control={
                      found.length > 0 ? (
                        <GroupSwitch
                          name={server.name}
                          tools={found}
                          disabled={disabledSet}
                          pending={pending}
                          onSetEnabled={setEnabled}
                        />
                      ) : undefined
                    }
                    action={
                      found.length > 0 ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full"
                          onClick={() => setOpenGroup(groupNameFor(server))}
                        >
                          View {found.length}{" "}
                          {found.length === 1 ? "tool" : "tools"}
                        </Button>
                      ) : asked ? (
                        <Button variant="outline" size="sm" className="w-full" disabled>
                          {discovering ? "Connecting…" : "No tools"}
                        </Button>
                      ) : (
                        // Never dialled: this server is switched off, and
                        // connecting to it costs a real connection — a spawned
                        // process, for stdio. Asking is the operator's call.
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full"
                          onClick={() =>
                            setPreviewIds((prev) => new Set([...prev, server.id]))
                          }
                        >
                          Discover tools
                        </Button>
                      )
                    }
                  />
                </li>
              );
            })}
          </ul>
          </>
        )}
      </section>

      {openGroup && (
        <ToolGroupDialog
          group={openGroup}
          tools={openTools}
          disabled={disabledSet}
          pending={pending}
          onSetTool={(name, enabled) => void setEnabled([name], enabled)}
          open
          onOpenChange={(next) => !next && setOpenGroup(null)}
        />
      )}
    </div>
  );
}

/**
 * What the card's dot says about a server the agent may or may not be able to use.
 *
 * `discovering` matters because tool discovery is a live round trip to the
 * server itself. Without it a server that simply has not answered yet is shown
 * as "No tools discovered" — the same wording as a genuinely broken one, on the
 * page someone opens precisely to find out which they have.
 *
 * `asked` separates a third case the two above cannot express: a disabled
 * server nobody has dialled. It is not broken and it is not connecting; it has
 * simply never been contacted.
 */
function serverStatus(
  server: McpServerSummary,
  toolCount: number,
  discovering: boolean,
  asked: boolean,
): { tone: "ok" | "warn" | "idle"; label: string } {
  if (!server.enabled) {
    // Listed, never attachable: the harness reads mcp_servers with an enabled
    // filter on every chat path, so these tools are a preview only.
    if (toolCount > 0) {
      return { tone: "idle", label: `Disabled · ${toolCount} tools listed` };
    }
    if (!asked) return { tone: "idle", label: "Disabled · not connected" };
    return discovering
      ? { tone: "idle", label: "Disabled · connecting…" }
      : { tone: "warn", label: "Disabled · unreachable" };
  }
  if (toolCount > 0) return { tone: "ok", label: "Connected" };
  if (discovering) return { tone: "idle", label: "Connecting…" };
  return { tone: "warn", label: "No tools discovered" };
}

/**
 * A group's master switch.
 *
 * On when anything in the group is on, and dimmed when only some of it is — the
 * same reading the composer's group switch uses, so the two surfaces never
 * describe the same half-on group differently. Flipping it writes every tool in
 * the group in one request, which the unique constraint on tool_name makes
 * atomic.
 */
function GroupSwitch({
  name,
  tools,
  disabled,
  pending,
  onSetEnabled,
}: {
  name: string;
  tools: ToolInfo[];
  disabled: ReadonlySet<string>;
  pending: ReadonlySet<string>;
  onSetEnabled: (names: string[], enabled: boolean) => void;
}) {
  const names = tools.map((tool) => tool.name);
  const on = names.filter((toolName) => !disabled.has(toolName)).length;
  const partial = on > 0 && on < names.length;
  const busy = names.some((toolName) => pending.has(toolName));

  return (
    <Switch
      checked={on > 0}
      disabled={busy}
      onCheckedChange={(next) => onSetEnabled(names, next)}
      aria-label={`Toggle every tool in ${name}`}
      title={
        partial ? `${on} of ${names.length} tools in ${name} are on.` : undefined
      }
      className={cn(partial && "opacity-60")}
    />
  );
}

/** The built-in section's grid. MCP renders its own cards, one per server. */
function GroupGrid({
  groups,
  query,
  disabled,
  pending,
  onSetEnabled,
  onManage,
  emptyTitle,
}: {
  groups: ToolGroup[];
  query: string;
  disabled: ReadonlySet<string>;
  pending: ReadonlySet<string>;
  onSetEnabled: (names: string[], enabled: boolean) => void;
  onManage: (group: string) => void;
  emptyTitle: string;
}) {
  if (groups.length === 0) {
    return (
      <EmptyState
        icon={Wrench}
        title={emptyTitle}
        description={query.trim() ? `Nothing matches “${query}”.` : undefined}
      />
    );
  }

  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {groups.map((group) => {
        const { icon, tone } = groupPresentation(group.name);
        const off = group.tools.filter((tool) =>
          disabled.has(tool.name),
        ).length;
        return (
          <li key={group.name}>
            <ResourceCard
              icon={icon}
              tone={tone}
              title={group.name}
              kind="Tool group"
              meta={
                off > 0
                  ? `${group.tools.length} tools · ${off} off`
                  : `${group.tools.length} ${group.tools.length === 1 ? "tool" : "tools"}`
              }
              control={
                <GroupSwitch
                  name={group.name}
                  tools={group.tools}
                  disabled={disabled}
                  pending={pending}
                  onSetEnabled={onSetEnabled}
                />
              }
              action={
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => onManage(group.name)}
                >
                  Manage
                </Button>
              }
            />
          </li>
        );
      })}
    </ul>
  );
}
