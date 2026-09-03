"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import ChatHistoryAccordion from "@/components/shell/ChatHistoryAccordion";
import HarnessStatus from "@/components/shell/HarnessStatus";
import NewChatButton from "@/components/shell/NewChatButton";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar";
import { useStoredPreference } from "@/hooks/use-stored-preference";
import { isNavActive, NAV_GROUPS, type NavGroup } from "@/lib/nav";

export default function AppSidebar() {
  const pathname = usePathname();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="h-14 flex-row items-center border-b px-2 py-0">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <Link href="/">
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary font-mono text-sm font-semibold text-sidebar-primary-foreground">
                  H
                </div>
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate text-sm font-semibold">Harness</span>
                  <span className="truncate text-[11px] text-muted-foreground">
                    agent control plane
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      {/* Collapsed to icons the group labels are invisible, so each group's
          own p-2 plus this gap-2 just stacks ~24px of dead space between
          rows that are 4px apart inside a group. Match the menu's own gap-1
          there so the rail reads as one evenly spaced column. */}
      <SidebarContent className="group-data-[collapsible=icon]:gap-1">
        <SidebarGroup className="group-data-[collapsible=icon]:py-0">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <NewChatButton />
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <ChatHistoryAccordion />

        <SidebarSeparator className="mx-2" />

        {NAV_GROUPS.map((group) => (
          <NavGroupSection key={group.id} group={group} pathname={pathname} />
        ))}
      </SidebarContent>

      <SidebarFooter>
        <HarnessStatus />
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}

/**
 * Hoisted rather than inlined below: `useStoredPreference` closes over
 * `allowed` in a useCallback dep list, so a fresh array literal per render
 * would rebuild the snapshot reader on every pass.
 */
const OPEN_STATES = ["open", "closed"] as const;

/**
 * One collapsible section of the rail.
 *
 * A component rather than a map body because the open/closed preference is a
 * hook, and hooks cannot be called from inside a `.map()`.
 */
function NavGroupSection({
  group,
  pathname,
}: {
  group: NavGroup;
  pathname: string;
}) {
  const { state } = useSidebar();
  const [stored, setStored] = useStoredPreference<(typeof OPEN_STATES)[number]>(
    `nav_group_${group.id}`,
    group.defaultOpen ? "open" : "closed",
    OPEN_STATES,
  );

  // In the 3rem icon rail a closed group would unmount its rows, taking those
  // icons off the only navigation left — and the label that would reopen it is
  // hidden too. Collapsed rail therefore always shows every group.
  const collapsedRail = state === "collapsed";
  const open = collapsedRail || stored === "open";

  return (
    <Collapsible
      open={open}
      onOpenChange={(next) => setStored(next ? "open" : "closed")}
      className="group/collapsible"
    >
      <SidebarGroup className="group-data-[collapsible=icon]:py-0">
        {/* The trigger is dropped in icon mode: the label is visually hidden
            there, and a zero-height hit target still swallows clicks. */}
        {collapsedRail ? (
          <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
        ) : (
          <SidebarGroupLabel asChild>
            <CollapsibleTrigger className="w-full cursor-pointer hover:text-sidebar-accent-foreground">
              {group.label}
              <ChevronDown className="ml-auto size-3.5 transition-transform group-data-[state=open]/collapsible:rotate-180" />
            </CollapsibleTrigger>
          </SidebarGroupLabel>
        )}
        {/* Same easing as the "Previous chats" accordion directly above, so
            the two kinds of disclosure in the rail do not feel different. */}
        <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
          <SidebarGroupContent>
            <SidebarMenu>
              {group.items.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    asChild
                    tooltip={item.label}
                    isActive={isNavActive(item.href, pathname)}
                  >
                    <Link href={item.href}>
                      <item.icon />
                      <span>{item.shortLabel ?? item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
}
