import { notFound } from "next/navigation";

import McpEditor from "@/components/mcp/McpEditor";
import type { Credential } from "@/lib/credential-types";
import type { McpServer } from "@/lib/registry-types";
import { listCredentials } from "@/lib/server/credential-service";
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

  // Offered as the link target for a remote server's Authorization header.
  // A failure here must not take down the editor: the credential link is one
  // optional field, and the rest of the page is still worth rendering. There is
  // no mock branch on listCredentials, so this also covers mock mode.
  let credentials: Credential[] = [];
  try {
    credentials = await listCredentials();
  } catch {
    credentials = [];
  }

  return <McpEditor server={server} credentials={credentials} />;
}
