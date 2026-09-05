"use client";

import { Plug, Search, Wrench } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import EmptyState from "@/components/registry/EmptyState";
import ResourceCard from "@/components/registry/ResourceCard";
import SectionHeader from "@/components/registry/SectionHeader";
import ToolGroupDialog from "@/components/tools/ToolGroupDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { mcpApi } from "@/lib/registry-api";
import type { McpServerSummary } from "@/lib/registry-types";
import {
  groupPresentation,
  groupTools,
  toolGroupName,
  type ToolGroup,
} from "@/lib/tool-groups";
import { fetchTools, type ToolInfo } from "@/lib/workflow-api";

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
  const [servers, setServers] = useState<McpServerSummary[]>([]);
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

  const groups = useMemo(() => {
    if (!tools) return [];
    const needle = query.trim().toLowerCase();
    const matching = needle
      ? tools.filter(
          (tool) =>
            tool.name.toLowerCase().includes(needle) ||
            tool.description.toLowerCase().includes(needle),
        )
      : tools;
    return groupTools(matching);
  }, [tools, query]);

  const builtin = groups.filter((g) => !g.name.startsWith(MCP_GROUP_PREFIX));

  // One card per configured server, carrying whatever tools it discovered.
  // Filtering by name as well as by tool means a search still narrows the list
  // when a server has connected nothing.
  const mcpServers = useMemo(() => {
    const byGroup = new Map(groups.map((group) => [group.name, group]));
    const needle = query.trim().toLowerCase();

    return servers
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

  // The dialog reads from the unfiltered set: narrowing the grid should not
  // hide tools inside a group the operator then opens.
  const openTools = useMemo(
    () => (tools ?? []).filter((tool) => toolGroupName(tool) === openGroup),
    [tools, openGroup],
  );

  if (tools === null) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">Loading tools…</p>
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
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {mcpServers.map(({ server, tools: found }) => (
              <li key={server.id}>
                <ResourceCard
                  icon={Plug}
                  tone="purple"
                  title={server.name}
                  kind={server.transport}
                  meta={server.description ?? server.url ?? server.command}
                  status={serverStatus(server, found.length)}
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

/** What the card's dot says about a server the agent may or may not be able to use. */
function serverStatus(
  server: McpServerSummary,
  toolCount: number,
): { tone: "ok" | "warn" | "idle"; label: string } {
  if (!server.enabled) return { tone: "idle", label: "Disabled" };
  if (toolCount === 0) return { tone: "warn", label: "No tools discovered" };
  return { tone: "ok", label: "Connected" };
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
