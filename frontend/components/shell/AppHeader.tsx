"use client";

import { usePathname } from "next/navigation";

import ActiveAgentBadge from "@/components/shell/ActiveAgentBadge";
import MockBadge from "@/components/shell/MockBadge";
import ThemeToggle from "@/components/shell/ThemeToggle";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { findNavItem } from "@/lib/nav";

/**
 * The one header for the whole app. Replaces the three near-identical inline
 * headers that used to live in ChatWindow, WorkflowEditor and the workflows
 * list page.
 */
export default function AppHeader() {
  const pathname = usePathname();
  const section = findNavItem(pathname);

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 !h-4" />
      <div className="min-w-0">
        <h1 className="truncate text-sm font-semibold tracking-tight">
          {section?.label ?? "Harness"}
        </h1>
        {section && (
          <p className="truncate text-[11px] text-muted-foreground">
            {section.blurb}
          </p>
        )}
      </div>
      <div className="ml-auto flex items-center gap-2 pl-3">
        <ActiveAgentBadge />
        <MockBadge />
        <ThemeToggle />
      </div>
    </header>
  );
}
