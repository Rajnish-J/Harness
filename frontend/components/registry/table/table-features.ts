import {
  columnFilteringFeature,
  columnVisibilityFeature,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  filterFn_includesString,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_text,
  tableFeatures,
} from "@tanstack/react-table";

/**
 * The table behaviour every list view in this app uses.
 *
 * TanStack Table v9 is opt-in: anything not registered here is tree-shaken out
 * of the bundle, and that includes the built-in filter and sort functions. The
 * catch is that an unregistered function is not a type error at the call site —
 * it fails at runtime — so the rule is that a `*-columns.tsx` file may only name
 * a `filterFn` or `sortFn` that appears below.
 *
 * `includesString` backs the text search; `text` and `alphanumeric` back the
 * string and numeric column sorts respectively. The core row model is always
 * present and is never registered.
 *
 * ONE features object, shared, rather than one per table. Which methods exist
 * on a `Column` or a `ReactTable` is decided by which features were registered,
 * so the DataTable* components in this folder are generic over the ROW type and
 * concrete in this one — that is what lets them call `getCanSort` at all. A
 * table that genuinely needed different behaviour would declare its own object
 * and its own helpers; wanting different FEATURES is the signal to fork, not
 * wanting a different row.
 */
export const features = tableFeatures({
  columnFilteringFeature,
  columnVisibilityFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  filteredRowModel: createFilteredRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortedRowModel: createSortedRowModel(),
  filterFns: { includesString: filterFn_includesString },
  sortFns: { alphanumeric: sortFn_alphanumeric, text: sortFn_text },
});

/** Pass as the first generic to `ColumnDef`, `Column`, `Table` and `Row` so each
 *  knows which feature APIs exist on it. */
export type RegistryTableFeatures = typeof features;
