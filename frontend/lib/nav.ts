/**
 * The single source of truth for top-level navigation.
 *
 * Before this existed, the same links were hand-written into three separate
 * inline page headers. The sidebar and the header breadcrumb both read from
 * here, so a new section is one entry, not three edits.
 *
 * Groups are the authored shape and `NAV_ITEMS` is derived from them, so the
 * flat list can never drift out of sync with what the rail actually renders.
 * The grouping follows the two seams that already exist in the backend rather
 * than an arbitrary tidy-up: Agents/Skills/Memory are what the model *reads*
 * (prompt.py composes agent + skills + memories under one character ceiling),
 * MCP/Tools are what it can *reach* (toolsets.py resolves both into one tool
 * surface, which is why ToolsBrowser already links to /mcp).
 */

import {
  Bot,
  Brain,
  FolderGit2,
  GitBranch,
  KeyRound,
  MessageSquare,
  Plug,
  Settings,
  Sparkles,
  Waypoints,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  /**
   * Rail text where the group label already carries the noun — "Memory ›
   * Browse" reads better than "Memory › Memory". `label` still feeds the
   * header and the icon-rail tooltip, so a collapsed rail never shows a
   * context-free "Browse".
   */
  shortLabel?: string;
  /** Sub-line shown in page headers, not in the sidebar rail. */
  blurb: string;
  icon: LucideIcon;
};

export type NavGroup = {
  /** Stable: it is the suffix of the persisted open/closed preference key. */
  id: string;
  label: string;
  defaultOpen: boolean;
  items: NavItem[];
};

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "workspace",
    label: "Workspace",
    defaultOpen: true,
    items: [
      {
        href: "/",
        label: "Chat",
        blurb: "Talk to the harness agent",
        icon: MessageSquare,
      },
      {
        href: "/projects",
        label: "Projects",
        blurb: "Working trees the agent can work inside",
        icon: FolderGit2,
      },
      {
        href: "/workflows",
        label: "Workflows",
        blurb: "Multi-step agent pipelines on a canvas",
        icon: GitBranch,
      },
    ],
  },
  {
    id: "library",
    label: "Library",
    defaultOpen: true,
    items: [
      {
        href: "/agents",
        label: "Agents",
        blurb: "Reusable agent presets: prompt, model, tools",
        icon: Bot,
      },
      {
        href: "/skills",
        label: "Skills",
        blurb: "Instruction bundles an agent can load on demand",
        icon: Sparkles,
      },
    ],
  },
  {
    id: "memory",
    label: "Memory",
    defaultOpen: true,
    items: [
      {
        href: "/memory",
        label: "Memory",
        shortLabel: "Browse",
        blurb: "What the agent carries between conversations",
        icon: Brain,
      },
      {
        href: "/memory-insights",
        label: "Memory Insights",
        shortLabel: "Insights",
        blurb: "Where each memory came from, and how it reaches the agent",
        icon: Waypoints,
      },
    ],
  },
  {
    id: "integrations",
    label: "Integrations",
    defaultOpen: true,
    items: [
      {
        href: "/mcp",
        label: "MCP",
        blurb: "Model Context Protocol server connections",
        icon: Plug,
      },
      {
        href: "/tools",
        label: "Tools",
        blurb: "The tool surface registered in the Python harness",
        icon: Wrench,
      },
    ],
  },
  {
    id: "settings",
    label: "Settings",
    defaultOpen: true,
    items: [
      {
        href: "/settings",
        label: "Settings",
        shortLabel: "General",
        blurb: "Harness configuration, appearance, and mock surfaces",
        icon: Settings,
      },
      {
        // Secrets configuration rather than a connected service: this page
        // holds both personal tokens and per-project env vars.
        href: "/credentials",
        label: "Credentials",
        blurb: "Access tokens for GitHub and friends, encrypted at rest",
        icon: KeyRound,
      },
    ],
  },
];

export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

/**
 * `/` would match every path under `startsWith`, so it is compared exactly.
 * Everything else matches its subtree, keeping `/workflows/[id]` highlighted.
 *
 * The subtree test is per-SEGMENT, not a bare prefix: `/memory-insights`
 * starts with `/memory` as a string but is a sibling route, not a child, and
 * a bare `startsWith` lit up both entries in the sidebar at once.
 */
export function isNavActive(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function findNavItem(pathname: string): NavItem | null {
  // Longest href first so `/workflows` wins over `/` for `/workflows/abc`.
  const ranked = [...NAV_ITEMS].sort((a, b) => b.href.length - a.href.length);
  return ranked.find((item) => isNavActive(item.href, pathname)) ?? null;
}

/** The group owning the current route, for the header's `Group › Page` line. */
export function findNavGroup(pathname: string): NavGroup | null {
  const item = findNavItem(pathname);
  if (!item) return null;
  return NAV_GROUPS.find((group) => group.items.includes(item)) ?? null;
}
