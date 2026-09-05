import { Plug } from "lucide-react";

import CatalogButton from "@/components/mcp/CatalogButton";
import NewMcpButton from "@/components/mcp/NewMcpButton";
import RegistryGrid from "@/components/registry/RegistryGrid";
import SectionHeader from "@/components/registry/SectionHeader";
import PageBody from "@/components/shell/PageBody";
import { describeDbError } from "@/lib/server/db-error";
import { listMcpServers } from "@/lib/server/registry-service";

export const dynamic = "force-dynamic";

export default async function McpPage() {
  let servers: Awaited<ReturnType<typeof listMcpServers>> = [];
  let error: string | null = null;

  try {
    servers = await listMcpServers();
  } catch (err) {
    error = `Could not load MCP servers: ${describeDbError(err)}`;
  }

  // Name -> id, so a catalog entry that is already configured offers "Manage"
  // instead of adding a duplicate the unique index would reject.
  const installed = Object.fromEntries(
    servers.map((server) => [server.name, server.id]),
  );

  return (
    <PageBody width="wide">
      <div className="flex flex-col gap-4">
        <SectionHeader
          title="MCP Servers"
          hint="Model Context Protocol servers. Each one's tools reach the agent namespaced as mcp__{server}__{tool}."
          action={
            <div className="flex items-center gap-2">
              <CatalogButton installed={installed} />
              <NewMcpButton />
            </div>
          }
        />
        <RegistryGrid
          error={error}
          href={(id) => `/mcp/${id}`}
          icon={Plug}
          tone="purple"
          empty={{
            title: "No MCP servers connected",
            description:
              "Connect a server to extend the agent's tool surface beyond the built-ins.",
            action: (
              <div className="flex items-center gap-2">
                <CatalogButton installed={installed} />
                <NewMcpButton />
              </div>
            ),
          }}
          rows={servers.map((server) => ({
            id: server.id,
            title: server.name,
            kind: server.transport,
            meta: server.description ?? server.command ?? server.url,
            enabled: server.enabled,
          }))}
        />
      </div>
    </PageBody>
  );
}
