"use client";

import { createColumnHelper } from "@tanstack/react-table";
import { FolderGit2 } from "lucide-react";
import Link from "next/link";

import ProjectActionsMenu from "@/components/projects/ProjectActionsMenu";
import {
  projectRepoLabel,
  projectStatus,
} from "@/components/projects/ProjectCard";
import DataTableColumnHeader from "@/components/registry/table/DataTableColumnHeader";
import { type RegistryTableFeatures } from "@/components/registry/table/table-features";
import { STATUS_TONES } from "@/components/registry/ResourceCard";
import { Checkbox } from "@/components/ui/checkbox";
import { relativeTime } from "@/lib/relative-time";
import { cn } from "@/lib/utils";
import type { ProjectListRow } from "@/lib/project-types";

/** Human labels for the column-visibility menu, where the raw ids read badly. */
export const COLUMN_LABELS: Record<string, string> = {
  name: "Name",
  repository: "Repository",
  branch: "Branch",
  status: "Status",
  fileCount: "Files",
  updatedAt: "Updated",
};

const columnHelper = createColumnHelper<RegistryTableFeatures, ProjectListRow>();

/**
 * A factory rather than a module constant: the row actions need callbacks that
 * live in ProjectsExplorer's state, and threading them through `meta` would
 * trade a closure for a cast.
 */
export function buildProjectColumns({
  onEdit,
  onDelete,
}: {
  onEdit: (project: ProjectListRow) => void;
  onDelete: (project: ProjectListRow) => void;
}) {
  return columnHelper.columns([
    columnHelper.display({
      id: "select",
      header: ({ table }) => (
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected()
              ? true
              : table.getIsSomePageRowsSelected()
                ? "indeterminate"
                : false
          }
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label="Select all"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label={`Select ${row.original.name}`}
        />
      ),
      enableSorting: false,
      enableHiding: false,
    }),

    columnHelper.accessor("name", {
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Name" />
      ),
      sortFn: "text",
      filterFn: "includesString",
      enableHiding: false,
      cell: ({ row }) => {
        const project = row.original;
        const ready = project.cloneStatus === "ready";
        return (
          <div className="flex items-center gap-2">
            <span className="grid size-6 shrink-0 place-items-center rounded-md bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-400">
              <FolderGit2 className="size-3.5" aria-hidden />
            </span>
            {ready ? (
              <Link
                href={`/projects/${project.id}/vscode`}
                className="font-medium hover:underline"
              >
                {project.name}
              </Link>
            ) : (
              <span className="font-medium text-muted-foreground">
                {project.name}
              </span>
            )}
          </div>
        );
      },
    }),

    columnHelper.accessor((row) => projectRepoLabel(row), {
      id: "repository",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Repository" />
      ),
      sortFn: "text",
      cell: ({ getValue }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {getValue()}
        </span>
      ),
    }),

    columnHelper.accessor((row) => row.currentBranch ?? row.defaultBranch, {
      id: "branch",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Branch" />
      ),
      sortFn: "text",
      cell: ({ getValue }) => (
        <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px]">
          {getValue()}
        </span>
      ),
    }),

    columnHelper.accessor("cloneStatus", {
      id: "status",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Status" />
      ),
      sortFn: "text",
      cell: ({ row }) => {
        const status = projectStatus(row.original);
        return (
          <span
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
            title={status.label}
          >
            <span
              aria-hidden
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                STATUS_TONES[status.tone],
              )}
            />
            <span className="max-w-48 truncate">{status.label}</span>
          </span>
        );
      },
    }),

    columnHelper.accessor("fileCount", {
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Files" className="-ml-2" />
      ),
      sortFn: "alphanumeric",
      cell: ({ row }) => (
        <span className="tabular-nums text-xs text-muted-foreground">
          {row.original.cloneStatus === "ready"
            ? row.original.fileCount.toLocaleString()
            : "—"}
        </span>
      ),
    }),

    columnHelper.accessor("updatedAt", {
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Updated" />
      ),
      sortFn: "text",
      cell: ({ getValue }) => (
        <span
          className="text-xs text-muted-foreground"
          title={new Date(getValue()).toLocaleString()}
        >
          {relativeTime(getValue())}
        </span>
      ),
    }),

    columnHelper.display({
      id: "actions",
      cell: ({ row }) => (
        <div className="flex justify-end">
          <ProjectActionsMenu
            project={row.original}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        </div>
      ),
    }),
  ]);
}
