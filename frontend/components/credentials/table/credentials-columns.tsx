"use client";

import { createColumnHelper } from "@tanstack/react-table";
import { KeyRound } from "lucide-react";
import Link from "next/link";

import CredentialActionsMenu from "@/components/credentials/CredentialActionsMenu";
import { credentialStatus } from "@/components/credentials/CredentialCard";
import { STATUS_TONES } from "@/components/registry/ResourceCard";
import DataTableColumnHeader from "@/components/registry/table/DataTableColumnHeader";
import { type RegistryTableFeatures } from "@/components/registry/table/table-features";
import { Checkbox } from "@/components/ui/checkbox";
import { maskToken, PROVIDER_LABELS, type Credential } from "@/lib/credential-types";
import { relativeTime } from "@/lib/relative-time";
import { cn } from "@/lib/utils";

/** Human labels for the column-visibility menu, where the raw ids read badly. */
export const COLUMN_LABELS: Record<string, string> = {
  name: "Name",
  provider: "Provider",
  token: "Token",
  status: "Status",
  updatedAt: "Updated",
};

const columnHelper = createColumnHelper<RegistryTableFeatures, Credential>();

/**
 * A factory rather than a module constant, for the reason buildProjectColumns
 * gives: the row actions need callbacks that live in the explorer's state, and
 * threading them through `meta` would trade a closure for a cast.
 */
export function buildCredentialColumns({
  onDelete,
}: {
  onDelete: (credential: Credential) => void;
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
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <span className="grid size-6 shrink-0 place-items-center rounded-md bg-green-50 text-green-600 dark:bg-green-500/15 dark:text-green-400">
            <KeyRound className="size-3.5" aria-hidden />
          </span>
          <Link
            href={`/credentials/${row.original.id}`}
            className="font-medium hover:underline"
          >
            {row.original.name}
          </Link>
        </div>
      ),
    }),

    columnHelper.accessor((row) => PROVIDER_LABELS[row.provider], {
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
      id: "token",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Token" />
      ),
      // Sorting by the last four characters of a secret is meaningless, and a
      // sortable header invites a click that tells you nothing.
      enableSorting: false,
      cell: ({ getValue }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {maskToken(getValue())}
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
        const status = credentialStatus(row.original);
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
          <CredentialActionsMenu credential={row.original} onDelete={onDelete} />
        </div>
      ),
    }),
  ]);
}
