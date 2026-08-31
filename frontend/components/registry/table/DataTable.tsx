"use client";

import {
  useTable,
  type ColumnFiltersState,
  type ColumnVisibilityState,
  type RowData,
  type RowSelectionState,
  type SortingState,
  type TableOptions,
} from "@tanstack/react-table";
import { Search, Trash2 } from "lucide-react";
import { useState } from "react";

import DataTablePagination from "@/components/registry/table/DataTablePagination";
import DataTableViewOptions from "@/components/registry/table/DataTableViewOptions";
import {
  features,
  type RegistryTableFeatures,
} from "@/components/registry/table/table-features";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/**
 * The list view every registry page shares: rows with sorting, a text filter,
 * column visibility, selection and pagination.
 *
 * Generic over the ROW type only. Everything that differs between two lists —
 * which columns exist, what the filter searches, what a bulk action does — is a
 * prop; everything that is chrome lives here once. The alternative was a third
 * copy of the same 150 lines of `<Table>` markup, differing only in the word
 * "project".
 *
 * Selection exists so bulk delete is worth having in the list at all: clearing
 * out six abandoned experiments is the one job a card grid is bad at. Callers
 * get the selected rows and decide what to do with them, so a list without a
 * bulk action simply omits `onBulkDelete` and the button never appears.
 *
 * `columns` is typed as the table's own option rather than a hand-written
 * `ColumnDef[]`: `TableOptions` defaults its `TValue` to `CellData`, which is
 * what a `createColumnHelper(...).columns([...])` array actually produces, and
 * spelling it out by hand invites a variance error on the first typed accessor.
 */
export default function DataTable<TData extends RowData>({
  rows,
  columns,
  getRowId,
  initialSorting,
  filter,
  noun,
  emptyMessage,
  columnLabels,
  toolbar,
  onBulkDelete,
}: {
  rows: TData[];
  columns: TableOptions<RegistryTableFeatures, TData>["columns"];
  /** Stable across a refresh: without it, deleting a row re-keys every
   *  selection by index and the wrong rows stay ticked. */
  getRowId: (row: TData) => string;
  initialSorting: SortingState;
  /** The column the search box filters, and how that box reads. */
  filter: { columnId: string; placeholder: string; label: string };
  noun: [singular: string, plural: string];
  /** Shown in place of the rows when the filter matches nothing. */
  emptyMessage: string;
  columnLabels?: Record<string, string>;
  /** Extra controls, left of the Columns button. */
  toolbar?: React.ReactNode;
  onBulkDelete?: (rows: TData[]) => void;
}) {
  const [sorting, setSorting] = useState<SortingState>(initialSorting);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] =
    useState<ColumnVisibilityState>({});
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  const table = useTable({
    features,
    data: rows,
    columns,
    getRowId,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    state: { sorting, columnFilters, columnVisibility, rowSelection },
  });

  const selected = table.getFilteredSelectedRowModel().rows;
  const filterColumn = table.getColumn(filter.columnId);

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-2 pb-3">
        <div className="relative max-w-xs flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            placeholder={filter.placeholder}
            aria-label={filter.label}
            value={(filterColumn?.getFilterValue() as string) ?? ""}
            onChange={(event) => filterColumn?.setFilterValue(event.target.value)}
            className="h-8 pl-8"
          />
        </div>

        {onBulkDelete && selected.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => onBulkDelete(selected.map((row) => row.original))}
          >
            <Trash2 />
            Delete {selected.length}
          </Button>
        )}

        <div className="ml-auto flex items-center gap-2">
          {toolbar}
          <DataTableViewOptions table={table} labels={columnLabels} />
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border">
        <Table>
          <TableHeader className="bg-muted/40">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder ? null : (
                      <table.FlexRender header={header} />
                    )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length > 0 ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() ? "selected" : undefined}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={table.getAllLeafColumns().length}
                  className="h-24 text-center text-sm text-muted-foreground"
                >
                  {emptyMessage}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <DataTablePagination table={table} noun={noun} />
    </div>
  );
}
