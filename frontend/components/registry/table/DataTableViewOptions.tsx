"use client";

import type { ReactTable, RowData } from "@tanstack/react-table";
import { SlidersHorizontal } from "lucide-react";

import type { RegistryTableFeatures } from "@/components/registry/table/table-features";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** Toggle which columns the table shows. */
export default function DataTableViewOptions<TData extends RowData>({
  table,
  labels = {},
}: {
  table: ReactTable<RegistryTableFeatures, TData>;
  /** Column id → human label. Falls back to the id, which is fine for
   *  single-word columns and not for `fileCount`. */
  labels?: Record<string, string>;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <SlidersHorizontal />
          Columns
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel>Show columns</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {table
          .getAllColumns()
          .filter((column) => column.getCanHide())
          .map((column) => (
            <DropdownMenuCheckboxItem
              key={column.id}
              checked={column.getIsVisible()}
              onCheckedChange={(value) => column.toggleVisibility(!!value)}
            >
              {labels[column.id] ?? column.id}
            </DropdownMenuCheckboxItem>
          ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
