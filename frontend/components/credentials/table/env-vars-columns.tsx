"use client";

import { createColumnHelper } from "@tanstack/react-table";
import { Braces, Lock } from "lucide-react";
import Link from "next/link";

import EnvVarActionsMenu from "@/components/credentials/EnvVarActionsMenu";
import { envVarStatus } from "@/components/credentials/EnvVarCard";
import { STATUS_TONES } from "@/components/registry/ResourceCard";
import DataTableColumnHeader from "@/components/registry/table/DataTableColumnHeader";
import { type RegistryTableFeatures } from "@/components/registry/table/table-features";
import { Checkbox } from "@/components/ui/checkbox";
import { displayValue, type EnvVarListRow } from "@/lib/env-var-types";
import { relativeTime } from "@/lib/relative-time";
import { cn } from "@/lib/utils";

/** Human labels for the column-visibility menu, where the raw ids read badly. */
export const COLUMN_LABELS: Record<string, string> = {
  key: "Name",
  projectName: "Project",
  value: "Value",
  status: "Type",
  updatedAt: "Updated",
};

const columnHelper = createColumnHelper<RegistryTableFeatures, EnvVarListRow>();

export function buildEnvVarColumns({
  onEdit,
  onDelete,
}: {
  onEdit: (envVar: EnvVarListRow) => void;
  onDelete: (envVar: EnvVarListRow) => void;
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
          aria-label={`Select ${row.original.key}`}
        />
      ),
      enableSorting: false,
      enableHiding: false,
    }),

    columnHelper.accessor("key", {
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Name" />
      ),
      sortFn: "text",
      filterFn: "includesString",
      enableHiding: false,
      cell: ({ row }) => {
        const Icon = row.original.secret ? Lock : Braces;
        return (
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "grid size-6 shrink-0 place-items-center rounded-md",
                row.original.secret
                  ? "bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400"
                  : "bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400",
              )}
            >
              <Icon className="size-3.5" aria-hidden />
            </span>
            <button
              type="button"
              onClick={() => onEdit(row.original)}
              className="font-mono text-xs font-medium hover:underline"
            >
              {row.original.key}
            </button>
          </div>
        );
      },
    }),

    columnHelper.accessor("projectName", {
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Project" />
      ),
      sortFn: "text",
      cell: ({ row }) => (
        <Link
          href={`/projects/${row.original.projectId}/vscode`}
          className="text-xs text-muted-foreground hover:text-foreground hover:underline"
        >
          {row.original.projectName}
        </Link>
      ),
    }),

    columnHelper.accessor((row) => displayValue(row), {
      id: "value",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Value" />
      ),
      // Sorting a column that is half masked bullets sorts nothing meaningful.
      enableSorting: false,
      cell: ({ getValue }) => {
        const value = getValue();
        return (
          <span className="block max-w-64 truncate font-mono text-xs text-muted-foreground">
            {value === "" ? "(empty)" : value}
          </span>
        );
      },
    }),

    columnHelper.accessor("secret", {
      id: "status",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Type" />
      ),
      sortFn: "text",
      cell: ({ row }) => {
        const status = envVarStatus(row.original);
        return (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span
              aria-hidden
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                STATUS_TONES[status.tone],
              )}
            />
            {status.label}
          </span>
        );
      },
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
          <EnvVarActionsMenu
            envVar={row.original}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        </div>
      ),
    }),
  ]);
}
