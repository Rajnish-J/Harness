/**
 * The single source of truth for top-level navigation.
 *
 * Before this existed, the same links were hand-written into three separate
 * inline page headers. The sidebar and the header breadcrumb both read from
 * here, so a new section is one entry, not three edits.
 */

import {
  Bot,
  FolderGit2,
  GitBranch,
  KeyRound,
  MessageSquare,
  Plug,
  Sparkles,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  /** Sub-line shown in page headers, not in the sidebar rail. */
  blurb: string;
  icon: LucideIcon;
};

export const NAV_ITEMS: NavItem[] = [
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
  {
    href: "/credentials",
    label: "Credentials",
    blurb: "Access tokens for GitHub and friends, encrypted at rest",
    icon: KeyRound,
  },
];

/**
 * `/` would match every path under `startsWith`, so it is compared exactly.
 * Everything else matches its subtree, keeping `/workflows/[id]` highlighted.
 */
export function isNavActive(href: string, pathname: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function findNavItem(pathname: string): NavItem | null {
  // Longest href first so `/workflows` wins over `/` for `/workflows/abc`.
  const ranked = [...NAV_ITEMS].sort((a, b) => b.href.length - a.href.length);
  return ranked.find((item) => isNavActive(item.href, pathname)) ?? null;
}
