"use client";

import { useMemo } from "react";

import {
  buildEnvVarColumns,
  COLUMN_LABELS,
} from "@/components/credentials/table/env-vars-columns";
import DataTable from "@/components/registry/table/DataTable";
import type { EnvVarListRow } from "@/lib/env-var-types";

/**
 * The list view for project environment variables: every variable across every
 * project as one flat, filterable table.
 *
 * Flat rather than grouped, unlike the grid. A table already carries a Project
 * column and sorts on it, so grouping would only add headings that break the
 * one thing the list is better at than the grid — comparing DATABASE_URL across
 * three projects without scrolling past everything else they hold.
 */
export default function EnvVarsTable({
  rows,
  onEdit,
  onDelete,
  toolbar,
}: {
  rows: EnvVarListRow[];
  onEdit: (envVar: EnvVarListRow) => void;
  onDelete: (envVars: EnvVarListRow[]) => void;
  /** The project filter, owned by the explorer so both views share it. */
  toolbar?: React.ReactNode;
}) {
  const columns = useMemo(
    () => buildEnvVarColumns({ onEdit, onDelete: (v) => onDelete([v]) }),
    [onEdit, onDelete],
  );

  return (
    <DataTable
      rows={rows}
      columns={columns}
      getRowId={(row) => row.id}
      initialSorting={[{ id: "projectName", desc: false }]}
      filter={{
        columnId: "key",
        placeholder: "Filter variables…",
        label: "Filter variables by name",
      }}
      noun={["variable", "variables"]}
      emptyMessage="No variables match that filter."
      columnLabels={COLUMN_LABELS}
      toolbar={toolbar}
      onBulkDelete={onDelete}
    />
  );
}
