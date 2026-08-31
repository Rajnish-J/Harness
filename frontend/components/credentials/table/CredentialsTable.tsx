"use client";

import { useMemo } from "react";

import {
  buildCredentialColumns,
  COLUMN_LABELS,
} from "@/components/credentials/table/credentials-columns";
import DataTable from "@/components/registry/table/DataTable";
import type { Credential } from "@/lib/credential-types";

/** The list view for personal credentials. All the chrome is DataTable's. */
export default function CredentialsTable({
  rows,
  onDelete,
}: {
  rows: Credential[];
  onDelete: (credentials: Credential[]) => void;
}) {
  const columns = useMemo(
    () => buildCredentialColumns({ onDelete: (c) => onDelete([c]) }),
    [onDelete],
  );

  return (
    <DataTable
      rows={rows}
      columns={columns}
      getRowId={(row) => row.id}
      initialSorting={[{ id: "updatedAt", desc: true }]}
      filter={{
        columnId: "name",
        placeholder: "Filter credentials…",
        label: "Filter credentials by name",
      }}
      noun={["credential", "credentials"]}
      emptyMessage="No credentials match that filter."
      columnLabels={COLUMN_LABELS}
      onBulkDelete={onDelete}
    />
  );
}
