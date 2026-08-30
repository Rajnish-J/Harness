"use client";

import { ExternalLink, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ProjectListRow } from "@/lib/project-types";

/**
 * Open / Edit / Delete for one project.
 *
 * One menu shared by the card, the table row, and the IDE toolbar (which
 * triggers it by clicking the project name instead of a `⋯` icon — hence the
 * overridable `trigger`). Three views of the same actions, so one missing from
 * any of them would be a bug the moment anyone noticed it.
 */
export default function ProjectActionsMenu({
  project,
  onEdit,
  onDelete,
  trigger,
}: {
  project: ProjectListRow;
  onEdit: (project: ProjectListRow) => void;
  onDelete: (project: ProjectListRow) => void;
  /** Defaults to the `⋯` icon button. */
  trigger?: React.ReactNode;
}) {
  const ready = project.cloneStatus === "ready";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {trigger ?? (
          <Button variant="ghost" size="icon-sm" className="text-muted-foreground">
            <MoreHorizontal />
            <span className="sr-only">Actions for {project.name}</span>
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        {/* Not rendered as a disabled link: a half-cloned project has no
            working tree, so the IDE it would open has nothing to show. */}
        {ready ? (
          <DropdownMenuItem asChild>
            <Link href={`/projects/${project.id}/vscode`}>
              <ExternalLink />
              Open
            </Link>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem disabled>
            <ExternalLink />
            Open
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => onEdit(project)}>
          <Pencil />
          Edit
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onSelect={() => onDelete(project)}
        >
          <Trash2 />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
