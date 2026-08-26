import NewMcpButton from "@/components/mcp/NewMcpButton";
import RegistryList from "@/components/registry/RegistryList";
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
    <PageBody toolbar={<NewMcpButton />}>
      <RegistryList
        error={error}
        href={(id) => `/mcp/${id}`}
        emptyMessage="No MCP servers connected yet. Add one to extend the agent's tool surface."
        rows={servers.map((server) => ({
          id: server.id,
          title: server.name,
          subtitle: server.description ?? server.command ?? server.url,
          badge: server.transport,
          enabled: server.enabled,
        }))}
      />
    </PageBody>
  );
}
