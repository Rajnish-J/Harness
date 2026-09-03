"use client";

import { useMemo } from "react";

import {
  buildModelCredentialColumns,
  COLUMN_LABELS,
} from "@/components/credentials/table/model-credentials-columns";
import DataTable from "@/components/registry/table/DataTable";
import type { ModelCredential } from "@/lib/model-credential-types";

/** The list view for provider keys. All the chrome is DataTable's. */
export default function ModelCredentialsTable({
  rows,
  onDelete,
}: {
  rows: ModelCredential[];
  onDelete: (credentials: ModelCredential[]) => void;
}) {
  const columns = useMemo(
    () => buildModelCredentialColumns({ onDelete: (c) => onDelete([c]) }),
    [onDelete],
  );

  return (
    <DataTable
      rows={rows}
      columns={columns}
      getRowId={(row) => row.id}
      // Sorted by provider, matching the service layer's own order: this list is
      // read as a checklist of which providers are set up, not as a feed.
      initialSorting={[{ id: "provider", desc: false }]}
      filter={{
        columnId: "name",
        placeholder: "Filter keys…",
        label: "Filter provider keys by name",
      }}
      noun={["key", "keys"]}
      emptyMessage="No provider keys match that filter."
      columnLabels={COLUMN_LABELS}
      onBulkDelete={onDelete}
    />
  );
}
