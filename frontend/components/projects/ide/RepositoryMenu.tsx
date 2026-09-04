"use client";

import { Globe, Link2, MonitorPlay, MoreVertical, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { DeploymentTargets } from "@/lib/ide-types";
import type { Project } from "@/lib/project-types";
import { cn } from "@/lib/utils";

/**
 * Where this project is connected, and where it is published.
 *
 * Deliberately short: four items, no section labels. Saving to the database
 * and the container password already have a home in ShareMenu — duplicating
 * them here was clutter, not helpfulness. "View pull request" left for the same
 * reason: the Git menu owns every pull-request verb, so this menu is about the
 * connection and the deployments, not the work in flight. The header states the
 * negative case ("No repository connected") somewhere the eye will actually
 * land, rather than leaving the absence to be inferred.
 */
export default function RepositoryMenu({
  project,
  deployments,
  onConnect,
}: {
  project: Project;
  deployments: DeploymentTargets;
  onConnect: () => void;
}) {
  const connected = Boolean(project.repoUrl);

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="text-muted-foreground">
              <MoreVertical />
              <span className="sr-only">Repository menu</span>
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Repository menu</TooltipContent>
      </Tooltip>

      <DropdownMenuContent align="end" className="w-64 p-1">
        <DropdownMenuLabel className="flex flex-col gap-0.5 px-2 py-1.5">
          <span className="truncate text-sm font-medium">{project.name}</span>
          <span className="flex items-center gap-1 text-[11px] font-normal text-muted-foreground">
            <Link2 className="size-3 shrink-0" aria-hidden />
            {connected
              ? `${project.repoOwner}/${project.repoName}`
              : "No repository connected"}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuItem onSelect={onConnect}>
          <Link2 />
          {connected ? "Change repository" : "Connect repository"}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() =>
            toast.info({
              title: "Reset is not wired up yet",
              description:
                "Discarding working-tree changes needs a git endpoint that does not exist.",
            })
          }
        >
          <RotateCcw />
          Reset changes
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          disabled={!deployments.previewUrl}
          onSelect={() => {
            if (deployments.previewUrl) {
              window.open(deployments.previewUrl, "_blank", "noopener");
            }
          }}
        >
          <MonitorPlay />
          Preview Site
          {deployments.previewUrl && (
            <span
              className={cn(
                "ml-auto size-1.5 shrink-0 rounded-full",
                deployments.previewLive ? "bg-emerald-500" : "bg-muted-foreground/40",
              )}
              aria-label={deployments.previewLive ? "live" : "stale"}
            />
          )}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!deployments.productionUrl}
          onSelect={() => {
            if (deployments.productionUrl) {
              window.open(deployments.productionUrl, "_blank", "noopener");
            }
          }}
        >
          <Globe />
          Production Site
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
