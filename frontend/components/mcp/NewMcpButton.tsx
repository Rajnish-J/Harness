"use client";

import NewRecordButton from "@/components/registry/NewRecordButton";
import { mcpApi } from "@/lib/registry-api";

export default function NewMcpButton() {
  return (
    <NewRecordButton
      label="New server"
      promptText="Name this MCP server"
      defaultName="new-server"
      hrefFor={(id) => `/mcp/${id}`}
      // Keyed by name, not slug: there is no slug column on mcp_servers.
      showSlug={false}
      // stdio with a placeholder command: the POST route rejects a stdio
      // server with no command, and the editor is where the real one is set.
      create={(name) => mcpApi.create({ name, transport: "stdio", command: "npx" })}
    />
  );
}
