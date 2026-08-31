"use client";

import { Check, History, RotateCcw } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { WorkspaceVersion } from "@/lib/ide-types";
import { cn } from "@/lib/utils";

/**
 * The `v3 ▾` control: every saved state of the working tree, newest first.
 *
 * Reverting is the whole point of the menu, so each row carries its own revert
 * button rather than making the row itself the action — clicking a version to
 * *inspect* it and clicking to *overwrite your tree with it* are different
 * enough intents that conflating them would be a trap.
 *
 * Nothing persists versions yet (see lib/mock/ide.ts). Revert is deliberately
 * left as a toast rather than faked convincingly: a control that appears to
 * restore files and does not is worse than one that says it cannot.
 */
export default function VersionHistoryMenu({
  versions,
}: {
  versions: WorkspaceVersion[];
}) {
  const [open, setOpen] = useState(false);
  const current = versions.find((version) => version.current) ?? versions.at(-1);

  if (versions.length === 0) return null;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-muted-foreground"
            >
              <History className="size-3.5" />
              <span className="text-xs">v{current?.number ?? 1}</span>
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Version history</TooltipContent>
      </Tooltip>

      <DropdownMenuContent align="end" className="w-72 p-0">
        <DropdownMenuLabel className="px-3 py-2.5 text-xs font-normal text-muted-foreground">
          {versions.length} {versions.length === 1 ? "version" : "versions"} in
          this chat
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="my-0" />

        <ul className="p-1">
          {versions.map((version) => (
            <li
              key={version.id}
              className={cn(
                "flex items-center gap-2 rounded-sm px-2 py-2",
                version.current ? "bg-accent/60" : "hover:bg-accent",
              )}
            >
              <span className="grid size-4 shrink-0 place-items-center">
                {version.current && (
                  <Check className="size-3.5 text-foreground" aria-hidden />
                )}
              </span>

              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="text-sm font-medium">
                    Version {version.number}
                  </span>
                  {version.current && (
                    <span className="rounded bg-muted px-1 py-px text-[9px] font-medium tracking-wide text-muted-foreground uppercase">
                      Current
                    </span>
                  )}
                </span>
                <span className="block text-[11px] text-muted-foreground">
                  {version.filesChanged} file
                  {version.filesChanged === 1 ? "" : "s"} changed ·{" "}
                  {version.filesTotal} total
                </span>
              </span>

              {!version.current && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="shrink-0 text-muted-foreground"
                  title={`Revert to version ${version.number}`}
                  onClick={() => {
                    setOpen(false);
                    toast.info({
                      title: `Reverting is not wired up yet`,
                      description: `Version ${version.number} would replace the working tree. Nothing stores versions yet — see NEXT_PUBLIC_MOCK_IDE.`,
                    });
                  }}
                >
                  <RotateCcw />
                  <span className="sr-only">
                    Revert to version {version.number}
                  </span>
                </Button>
              )}
            </li>
          ))}
        </ul>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
