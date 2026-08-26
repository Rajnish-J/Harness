/**
 * What the composer's tool allowlist means, and how the panel's switches
 * change it.
 *
 * Grouping and icons live in lib/tool-groups.ts (shared with the /tools page);
 * this is only the selection arithmetic, which is specific to chat.
 *
 * The allowlist is tri-state on the wire — null is "inherit everything", a list
 * narrows both the advertised schemas and dispatch — and that is what makes the
 * toggles below more than a `has()` check. Switching a group off while
 * inheriting has to materialise the full list first, or the request would read
 * as "grant nothing except this".
 */

import { groupTools, type ToolGroup } from "./tool-groups";
import type { ToolInfo } from "./workflow-api";

/** The prefix backend/app/mcp/tools.py gives every discovered tool's group. */
export const MCP_GROUP_PREFIX = "MCP · ";

export type GroupState = "on" | "off" | "partial";

export type SelectableGroup = ToolGroup & {
  /** How many of this group's tools the current allowlist admits. */
  enabled: number;
  state: GroupState;
  isMcp: boolean;
};

export function isToolEnabled(name: string, toolNames: string[] | null): boolean {
  return toolNames === null || toolNames.includes(name);
}

/**
 * The harness's groups, annotated with what the current allowlist admits.
 *
 * MCP sections are moved to the end so a server connecting does not reshuffle
 * the built-in sections above it.
 */
export function selectableGroups(
  tools: ToolInfo[],
  toolNames: string[] | null,
): SelectableGroup[] {
  const groups = groupTools(tools).map((group) => {
    const enabled = group.tools.filter((tool) =>
      isToolEnabled(tool.name, toolNames),
    ).length;

    return {
      ...group,
      enabled,
      state:
        enabled === 0 ? "off" : enabled === group.tools.length ? "on" : "partial",
      isMcp: group.name.startsWith(MCP_GROUP_PREFIX),
    } satisfies SelectableGroup;
  });

  return [...groups.filter((g) => !g.isMcp), ...groups.filter((g) => g.isMcp)];
}

/** "MCP · github" -> "github". */
export function serverNameFromGroup(group: string): string {
  return group.startsWith(MCP_GROUP_PREFIX)
    ? group.slice(MCP_GROUP_PREFIX.length)
    : group;
}

/**
 * Flip `names` on or off within an allowlist.
 *
 * `universe` is every tool the composer currently knows about, and is what
 * makes the tri-state work: turning something off while inheriting expands to
 * the full list minus that something, and a list that grows back to cover the
 * universe collapses to null so the request looks untouched again.
 */
export function toggleNames(
  current: string[] | null,
  names: string[],
  universe: string[],
): string[] | null {
  const active = current ?? universe;
  const target = new Set(names);
  const allOn = names.every((name) => active.includes(name));

  const next = new Set(
    allOn
      ? active.filter((name) => !target.has(name))
      : [...active, ...names],
  );

  if (next.size >= universe.length && universe.every((name) => next.has(name))) {
    return null;
  }
  // Ordered by the universe, so the wire body is stable no matter what order
  // things were clicked in.
  return universe.filter((name) => next.has(name));
}

export function toggleToolName(
  current: string[] | null,
  name: string,
  universe: string[],
): string[] | null {
  return toggleNames(current, [name], universe);
}

export function toggleGroupNames(
  current: string[] | null,
  group: SelectableGroup,
  universe: string[],
): string[] | null {
  return toggleNames(
    current,
    group.tools.map((tool) => tool.name),
    universe,
  );
}

/** "3 built-in · 2 MCP", for the pill's tooltip and the panel header. */
export function describeToolCounts(tools: ToolInfo[]): string {
  const mcp = tools.filter((tool) => tool.name.startsWith("mcp__")).length;
  return `${tools.length - mcp} built-in · ${mcp} MCP`;
}

/** How many tools this turn would actually offer the model. */
export function enabledCount(
  tools: ToolInfo[],
  toolNames: string[] | null,
): number {
  return toolNames === null
    ? tools.length
    : tools.filter((tool) => toolNames.includes(tool.name)).length;
}
