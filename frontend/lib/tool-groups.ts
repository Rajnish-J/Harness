/**
 * Presentation for the tool sections the harness reports.
 *
 * The grouping itself is the backend's call — `Tool.group` in
 * backend/app/agent/tools/base.py, which is "File Operations" for the built-ins
 * and `MCP · {server}` for anything an MCP server discovered. This module only
 * decides what a group looks like, and falls back cleanly for a group name it
 * has never seen, so adding a tool group in Python needs no frontend change.
 */

import { FolderOpen, Plug, ShieldCheck, Terminal, Wrench, type LucideIcon } from "lucide-react";

import type { CardTone } from "@/components/registry/ResourceCard";
import type { ToolInfo } from "@/lib/workflow-api";

/** An older harness predates `Tool.group`; those tools land here. */
export const UNGROUPED = "General";

export type ToolGroup = {
  name: string;
  tools: ToolInfo[];
};

const PRESENTATION: Record<string, { icon: LucideIcon; tone: CardTone }> = {
  "File Operations": { icon: FolderOpen, tone: "blue" },
  Validation: { icon: ShieldCheck, tone: "green" },
  Execution: { icon: Terminal, tone: "amber" },
};

const MCP_PRESENTATION = { icon: Plug, tone: "purple" } as const;
const FALLBACK = { icon: Wrench, tone: "neutral" } as const;

export function groupPresentation(name: string): { icon: LucideIcon; tone: CardTone } {
  return PRESENTATION[name] ?? (name.startsWith("MCP · ") ? MCP_PRESENTATION : FALLBACK);
}

/** The single place a tool's group name is normalized. */
export function toolGroupName(tool: ToolInfo): string {
  return tool.group?.trim() || UNGROUPED;
}

/**
 * Groups in first-seen order, which is the harness's own tool order — built-ins
 * before MCP, and stable across reloads so the grid does not reshuffle.
 */
export function groupTools(tools: ToolInfo[]): ToolGroup[] {
  const groups = new Map<string, ToolInfo[]>();

  for (const tool of tools) {
    const name = toolGroupName(tool);
    const existing = groups.get(name);
    if (existing) existing.push(tool);
    else groups.set(name, [tool]);
  }

  return [...groups].map(([name, groupTools]) => ({ name, tools: groupTools }));
}
