"use client";

import type { Column, RowData } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";

import type { RegistryTableFeatures } from "@/components/registry/table/table-features";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * A sortable column header.
 *
 * Generic over the ROW type, concrete in `RegistryTableFeatures` — see the note
 * in ./table-features.ts. An unconstrained `TFeatures` is the mistake v9
 * punishes: it provably has no `getCanSort`, because which methods a `Column`
 * carries is decided by which features the table registered.
 *
 * The icon always renders. A header that only grows an affordance on hover
 * gives no clue that sorting is available at all.
 */
export default function DataTableColumnHeader<TData extends RowData, TValue>({
  column,
  title,
  className,
}: {
  column: Column<RegistryTableFeatures, TData, TValue>;
  title: string;
  className?: string;
}) {
  if (!column.getCanSort()) {
    return <span className={className}>{title}</span>;
  }

  const sorted = column.getIsSorted();
  const Icon =
    sorted === "asc" ? ArrowUp : sorted === "desc" ? ArrowDown : ChevronsUpDown;

  return (
    <Button
      variant="ghost"
      size="xs"
      onClick={() => column.toggleSorting(sorted === "asc")}
      data-sorted={sorted !== false}
      className={cn(
        "-ml-2 gap-1 font-medium text-muted-foreground data-[sorted=true]:text-foreground",
        className,
      )}
    >
      {title}
      <Icon className="size-3 opacity-70" aria-hidden />
      <span className="sr-only">
        {sorted === "asc"
          ? "sorted ascending"
          : sorted === "desc"
            ? "sorted descending"
            : "not sorted"}
      </span>
    </Button>
  );
}
