"use client";

import type { ReactTable, RowData } from "@tanstack/react-table";
import { ChevronLeft, ChevronRight } from "lucide-react";

import type { RegistryTableFeatures } from "@/components/registry/table/table-features";
import { Button } from "@/components/ui/button";

/**
 * Page controls, plus the selection count.
 *
 * The two belong together: "3 of 12 selected" is the sentence that tells you a
 * selection survived a page change, which is the one thing about paginated
 * selection that surprises people.
 */
export default function DataTablePagination<TData extends RowData>({
  table,
  noun,
}: {
  table: ReactTable<RegistryTableFeatures, TData>;
  /** What the rows are — `["project", "projects"]`. Passed rather than derived
   *  because "variables" is not a suffix rule away from "variable" in every
   *  word this will ever be given. */
  noun: [singular: string, plural: string];
}) {
  const selected = table.getFilteredSelectedRowModel().rows.length;
  const total = table.getFilteredRowModel().rows.length;
  const pageCount = table.getPageCount();
  const pageIndex = table.state.pagination.pageIndex;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-3">
      <p className="text-xs text-muted-foreground">
        {selected > 0
          ? `${selected} of ${total} selected`
          : `${total} ${total === 1 ? noun[0] : noun[1]}`}
      </p>

      {pageCount > 1 && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            Page {pageIndex + 1} of {pageCount}
          </span>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            <ChevronLeft />
            <span className="sr-only">Previous page</span>
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            <ChevronRight />
            <span className="sr-only">Next page</span>
          </Button>
        </div>
      )}
    </div>
  );
}
