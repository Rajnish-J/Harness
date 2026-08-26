import { notFound } from "next/navigation";

import McpEditor from "@/components/mcp/McpEditor";
import type { McpServer } from "@/lib/registry-types";
import { getMcpServer } from "@/lib/server/registry-service";

export const dynamic = "force-dynamic";

// Next 16: params arrive as a Promise.
export default async function McpServerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const row = await getMcpServer(id);
  if (!row) notFound();

  // Dates cross into the client component as ISO strings.
  const server: McpServer = {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };

  return <McpEditor server={server} />;
}
