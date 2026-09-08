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
 *
 * The global disable list from /tools is a SECOND, separate axis, and the two
 * are deliberately never merged. It is threaded through the read helpers so a
 * disabled tool renders off and locked, and the harness subtracts it again in
 * _prepare_turn — but it never enters `universe`. Shrinking the universe would
 * let an otherwise-full selection collapse to null, which the wire reads as
 * "the whole registry", handing back exactly the tools someone switched off.
 * The universe is the catalog, always.
 */

import {
  MCP_GROUP_PREFIX,
  groupTools,
  serverNameFromGroup,
  type ToolGroup,
} from "./tool-groups";
import type { ToolInfo } from "./workflow-api";

// Both re-exported for the composer, which imports its whole tool vocabulary
// from this module. They live in tool-groups.ts because /tools needs them too.
export { MCP_GROUP_PREFIX, serverNameFromGroup };

export type GroupState = "on" | "off" | "partial";

export type SelectableGroup = ToolGroup & {
  /** How many of this group's tools this turn would actually offer the model:
   *  admitted by the allowlist AND not switched off globally. */
  enabled: number;
  /** How many could be turned on at all — the group minus its disabled tools.
   *  `enabled` is measured against this, not against `tools.length`, so a group
   *  with one tool disabled globally can still read as fully on. */
  selectable: number;
  state: GroupState;
  /** Every tool here is disabled globally, so the group's switch does nothing. */
  locked: boolean;
  isMcp: boolean;
};

/** The tools switched off for everyone on /tools. Empty is the common case. */
export type DisabledTools = ReadonlySet<string>;

export const NO_DISABLED_TOOLS: DisabledTools = new Set<string>();

export function isToolEnabled(
  name: string,
  toolNames: string[] | null,
  disabled: DisabledTools = NO_DISABLED_TOOLS,
): boolean {
  if (disabled.has(name)) return false;
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
  disabled: DisabledTools = NO_DISABLED_TOOLS,
): SelectableGroup[] {
  const groups = groupTools(tools).map((group) => {
    const enabled = group.tools.filter((tool) =>
      isToolEnabled(tool.name, toolNames, disabled),
    ).length;
    const selectable = group.tools.filter(
      (tool) => !disabled.has(tool.name),
    ).length;

    return {
      ...group,
      enabled,
      selectable,
      // Measured against `selectable`, not `tools.length`: a group whose every
      // remaining tool is on should read as on, rather than being stuck at
      // "partial" forever because of a tool nobody here can switch back on.
      state: enabled === 0 ? "off" : enabled === selectable ? "on" : "partial",
      locked: selectable === 0,
      isMcp: group.name.startsWith(MCP_GROUP_PREFIX),
    } satisfies SelectableGroup;
  });

  return [...groups.filter((g) => !g.isMcp), ...groups.filter((g) => g.isMcp)];
}

/**
 * Flip `names` on or off within an allowlist.
 *
 * `universe` is every tool the composer currently knows about, and is what
 * makes the tri-state work: turning something off while inheriting expands to
 * the full list minus that something, and a list that grows back to cover the
 * universe collapses to null so the request looks untouched again.
 *
 * Globally disabled tools stay IN the universe — see this file's header. They
 * are excluded when rendering, and again by the harness, never here.
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
  disabled: DisabledTools = NO_DISABLED_TOOLS,
): string[] | null {
  // Only the tools this group can actually offer. Including a globally disabled
  // one would keep `allOn` in toggleNames false forever — the group's switch
  // would turn on and never off, because one name could never be satisfied.
  const names = group.tools
    .map((tool) => tool.name)
    .filter((name) => !disabled.has(name));

  if (names.length === 0) return current;
  return toggleNames(current, names, universe);
}

/** "3 built-in · 2 MCP · 1 off", for the pill's tooltip and the panel header. */
export function describeToolCounts(
  tools: ToolInfo[],
  disabled: DisabledTools = NO_DISABLED_TOOLS,
): string {
  const mcp = tools.filter((tool) => tool.name.startsWith("mcp__")).length;
  const off = tools.filter((tool) => disabled.has(tool.name)).length;
  const base = `${tools.length - mcp} built-in · ${mcp} MCP`;
  return off > 0 ? `${base} · ${off} off` : base;
}

/** How many tools this turn would actually offer the model. */
export function enabledCount(
  tools: ToolInfo[],
  toolNames: string[] | null,
  disabled: DisabledTools = NO_DISABLED_TOOLS,
): number {
  return tools.filter((tool) => isToolEnabled(tool.name, toolNames, disabled))
    .length;
}
