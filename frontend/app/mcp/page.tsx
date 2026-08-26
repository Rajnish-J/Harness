import { Plug } from "lucide-react";

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

  return (
    <PageBody width="wide">
      <div className="flex flex-col gap-4">
        <SectionHeader
          title="MCP Servers"
          hint="Model Context Protocol servers. Each one's tools reach the agent namespaced as mcp__{server}__{tool}."
          action={<NewMcpButton />}
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
            action: <NewMcpButton />,
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
