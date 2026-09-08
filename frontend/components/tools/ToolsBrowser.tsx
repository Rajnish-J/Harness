"use client";

import { Plug, Search, Wrench } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

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
import { mcpApi } from "@/lib/registry-api";
import type { McpServerSummary } from "@/lib/registry-types";
import {
  groupPresentation,
  groupTools,
  toolGroupName,
  type ToolGroup,
} from "@/lib/tool-groups";
import {
  fetchMcpTools,
  fetchTools,
  type ToolInfo,
} from "@/lib/workflow-api";

/**
 * Read-only view of the harness's tool registry, one card per group.
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
 * Adding and managing stay on /mcp. This page reports; it does not configure.
 */
const MCP_GROUP_PREFIX = "MCP · ";

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
  const [query, setQuery] = useState("");
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchTools(controller.signal).then(setTools);
    // Separate origins: tools come from the Python harness, servers from this
    // app's own route. Either can be down without blanking the other, so the
    // server list failing just leaves the MCP section empty.
    mcpApi.list().then(setServers).catch(() => setServers([]));
    return () => controller.abort();
  }, []);

  // Discovery is a second round trip, made per enabled server, and it is the
  // only way this page can know a server's tools: GET /api/workflows/tools
  // returns the built-in registry alone and never contains an mcp__* tool, so
  // counting them out of `tools` would report zero for every server forever.
  const enabledIds = (servers ?? [])
    .filter((server) => server.enabled)
    .map((server) => server.id)
    .join(",");

  useEffect(() => {
    if (servers === null) return;
    const controller = new AbortController();
    const ids = enabledIds ? enabledIds.split(",") : [];

    fetchMcpTools(ids, controller.signal)
      .then(({ tools: found, notices }) => {
        if (controller.signal.aborted) return;
        setDiscovered({ tools: found, notices });
      })
      .catch(() => {
        // fetchMcpTools swallows its own failures; this only catches an abort.
      });

    return () => controller.abort();
  }, [enabledIds, servers]);

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

  // Both fetches must land before the page can tell "nothing here" from "not
  // asked yet". They resolve independently, and whichever wins the race would
  // otherwise render its half's empty state as if it were the answer.
  if (tools === null || servers === null) {
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

      <section className="flex flex-col gap-4">
        <SectionHeader
          title="Built-in Tools"
          hint="Registered in the Python harness. Every agent can be given any of them from its preset."
        />
        <GroupGrid
          groups={builtin}
          query={query}
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
            {mcpServers.map(({ server, tools: found }) => (
              <li key={server.id}>
                <ResourceCard
                  icon={Plug}
                  tone="purple"
                  title={server.name}
                  kind={server.transport}
                  meta={server.description ?? server.url ?? server.command}
                  status={serverStatus(server, found.length, discovering)}
                  action={
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      disabled={found.length === 0}
                      onClick={() => setOpenGroup(groupNameFor(server))}
                    >
                      {found.length === 0
                        ? "No tools"
                        : `View ${found.length} ${found.length === 1 ? "tool" : "tools"}`}
                    </Button>
                  }
                />
              </li>
            ))}
          </ul>
          </>
        )}
      </section>

      {openGroup && (
        <ToolGroupDialog
          group={openGroup}
          tools={openTools}
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
 */
function serverStatus(
  server: McpServerSummary,
  toolCount: number,
  discovering: boolean,
): { tone: "ok" | "warn" | "idle"; label: string } {
  if (!server.enabled) return { tone: "idle", label: "Disabled" };
  if (toolCount > 0) return { tone: "ok", label: "Connected" };
  if (discovering) return { tone: "idle", label: "Connecting…" };
  return { tone: "warn", label: "No tools discovered" };
}

/** The built-in section's grid. MCP renders its own cards, one per server. */
function GroupGrid({
  groups,
  query,
  onManage,
  emptyTitle,
}: {
  groups: ToolGroup[];
  query: string;
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
        return (
          <li key={group.name}>
            <ResourceCard
              icon={icon}
              tone={tone}
              title={group.name}
              kind="Tool group"
              meta={`${group.tools.length} ${group.tools.length === 1 ? "tool" : "tools"}`}
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
