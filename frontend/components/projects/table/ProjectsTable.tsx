"use client";

import { useMemo } from "react";

import {
  buildProjectColumns,
  COLUMN_LABELS,
} from "@/components/projects/table/projects-columns";
import DataTable from "@/components/registry/table/DataTable";
import type { ProjectListRow } from "@/lib/project-types";

/**
 * The list view: every project as a row.
 *
 * The chrome — filter box, column visibility, selection, pagination — is
 * DataTable's; this file is only the part that is about projects. Bulk delete
 * reuses the same dialog and the same archive→purge sequence as a single
 * delete, so there is no second code path.
 */
export default function ProjectsTable({
  rows,
  onEdit,
  onDelete,
}: {
  rows: ProjectListRow[];
  onEdit: (project: ProjectListRow) => void;
  onDelete: (projects: ProjectListRow[]) => void;
}) {
  // `buildProjectColumns` rebuilds every column when its callbacks change, and
  // ProjectsExplorer keeps those stable with useCallback for this reason.
  const columns = useMemo(
    () => buildProjectColumns({ onEdit, onDelete: (p) => onDelete([p]) }),
    [onEdit, onDelete],
  );

  return (
    <DataTable
      rows={rows}
      columns={columns}
      getRowId={(row) => row.id}
      initialSorting={[{ id: "updatedAt", desc: true }]}
      filter={{
        columnId: "name",
        placeholder: "Filter projects…",
        label: "Filter projects by name",
      }}
      noun={["project", "projects"]}
      emptyMessage="No projects match that filter."
      columnLabels={COLUMN_LABELS}
      onBulkDelete={onDelete}
    />
  );
}
