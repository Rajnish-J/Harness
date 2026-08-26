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
 */
const MCP_GROUP_PREFIX = "MCP · ";

export default function ToolsBrowser() {
  const [tools, setTools] = useState<ToolInfo[] | null>(null);
  const [query, setQuery] = useState("");
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchTools(controller.signal).then(setTools);
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
  const mcp = groups.filter((g) => g.name.startsWith(MCP_GROUP_PREFIX));

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

  if (tools.length === 0) {
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
          hint="Discovered from connected MCP servers and namespaced mcp__{server}__{tool}. One card per server."
          action={
            <Button variant="outline" size="sm" asChild>
              <Link href="/mcp">Manage servers</Link>
            </Button>
          }
        />
        <GroupGrid
          groups={mcp}
          query={query}
          onManage={setOpenGroup}
          emptyTitle={
            query.trim() ? "No MCP tools match" : "No MCP tools discovered"
          }
          emptyDescription={
            query.trim()
              ? undefined
              : "Connect and enable an MCP server to pull its tools into the agent's surface."
          }
          emptyIcon={Plug}
        />
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

function GroupGrid({
  groups,
  query,
  onManage,
  emptyTitle,
  emptyDescription,
  emptyIcon = Wrench,
}: {
  groups: ToolGroup[];
  query: string;
  onManage: (group: string) => void;
  emptyTitle: string;
  emptyDescription?: string;
  emptyIcon?: React.ComponentProps<typeof EmptyState>["icon"];
}) {
  if (groups.length === 0) {
    return (
      <EmptyState
        icon={emptyIcon}
        title={emptyTitle}
        description={
          emptyDescription ?? (query.trim() ? `Nothing matches “${query}”.` : undefined)
        }
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
