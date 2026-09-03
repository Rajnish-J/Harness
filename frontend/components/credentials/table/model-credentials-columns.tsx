"use client";

import { createColumnHelper } from "@tanstack/react-table";
import { Boxes, MoreHorizontal, Trash2 } from "lucide-react";

import { modelCredentialStatus } from "@/components/credentials/ModelCredentialCard";
import { STATUS_TONES } from "@/components/registry/ResourceCard";
import DataTableColumnHeader from "@/components/registry/table/DataTableColumnHeader";
import { type RegistryTableFeatures } from "@/components/registry/table/table-features";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  credentialLabel,
  maskKey,
  MODEL_PROVIDER_LABELS,
  type ModelCredential,
} from "@/lib/model-credential-types";
import { relativeTime } from "@/lib/relative-time";
import { cn } from "@/lib/utils";

/** Human labels for the column-visibility menu, where the raw ids read badly. */
export const COLUMN_LABELS: Record<string, string> = {
  name: "Name",
  provider: "Provider",
  key: "Key",
  status: "Status",
  models: "Extra models",
  lastValidatedAt: "Tested",
};

const columnHelper = createColumnHelper<RegistryTableFeatures, ModelCredential>();

/**
 * A factory rather than a module constant, matching buildCredentialColumns: the
 * row actions need callbacks that live in the explorer's state, and threading
 * them through `meta` would trade a closure for a cast.
 */
export function buildModelCredentialColumns({
  onDelete,
}: {
  onDelete: (credential: ModelCredential) => void;
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
          aria-label={`Select ${credentialLabel(row.original)}`}
        />
      ),
      enableSorting: false,
      enableHiding: false,
    }),

    columnHelper.accessor((row) => credentialLabel(row), {
      id: "name",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Name" />
      ),
      sortFn: "text",
      filterFn: "includesString",
      enableHiding: false,
      cell: ({ row, getValue }) => (
        <div className="flex items-center gap-2">
          <span className="grid size-6 shrink-0 place-items-center rounded-md bg-purple-50 text-purple-600 dark:bg-purple-500/15 dark:text-purple-400">
            <Boxes className="size-3.5" aria-hidden />
          </span>
          {/* No link: unlike a PAT there is no detail page to open. Everything
              editable lives in the dialog the actions menu opens. */}
          <span
            className={cn(
              "font-medium",
              !row.original.enabled && "text-muted-foreground",
            )}
          >
            {getValue()}
          </span>
        </div>
      ),
    }),

    columnHelper.accessor((row) => MODEL_PROVIDER_LABELS[row.provider], {
      id: "provider",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Provider" />
      ),
      sortFn: "text",
      cell: ({ getValue }) => (
        <span className="text-xs text-muted-foreground">{getValue()}</span>
      ),
    }),

    columnHelper.accessor("lastFour", {
      id: "key",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Key" />
      ),
      // Sorting by the last four characters of a secret is meaningless, and a
      // sortable header invites a click that tells you nothing.
      enableSorting: false,
      cell: ({ getValue }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {maskKey(getValue())}
        </span>
      ),
    }),

    columnHelper.accessor("enabled", {
      id: "status",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Status" />
      ),
      sortFn: "text",
      cell: ({ row }) => {
        const status = modelCredentialStatus(row.original);
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

    columnHelper.accessor((row) => row.extraModels.length, {
      id: "models",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Extra models" />
      ),
      // "alphanumeric", not "basic": only the two sort fns registered in
      // table-features.ts exist at runtime, and this one orders numbers.
      sortFn: "alphanumeric",
      cell: ({ row }) => {
        const count = row.original.extraModels.length;
        return (
          <span
            className="text-xs text-muted-foreground tabular-nums"
            title={row.original.extraModels.join(", ") || undefined}
          >
            {count || "—"}
          </span>
        );
      },
    }),

    columnHelper.accessor("lastValidatedAt", {
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Tested" />
      ),
      sortFn: "text",
      cell: ({ getValue }) => {
        const value = getValue();
        if (!value) return <span className="text-xs text-muted-foreground">Never</span>;
        return (
          <span
            className="text-xs text-muted-foreground"
            title={new Date(value).toLocaleString()}
          >
            {relativeTime(value)}
          </span>
        );
      },
    }),

    columnHelper.display({
      id: "actions",
      cell: ({ row }) => (
        <div className="flex justify-end">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground"
              >
                <MoreHorizontal />
                <span className="sr-only">
                  Actions for {credentialLabel(row.original)}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-36">
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => onDelete(row.original)}
              >
                <Trash2 />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    }),
  ]);
}
