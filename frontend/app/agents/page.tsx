import { Bot } from "lucide-react";

import NewAgentButton from "@/components/agents/NewAgentButton";
import RegistryGrid from "@/components/registry/RegistryGrid";
import SectionHeader from "@/components/registry/SectionHeader";
import PageBody from "@/components/shell/PageBody";
import { describeDbError } from "@/lib/server/db-error";
import { listAgents } from "@/lib/server/registry-service";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  let agents: Awaited<ReturnType<typeof listAgents>> = [];
  let error: string | null = null;

  try {
    agents = await listAgents();
  } catch (err) {
    error = `Could not load agents: ${describeDbError(err)}`;
  }

  return (
    <PageBody width="wide">
      <div className="flex flex-col gap-4">
        <SectionHeader
          title="Agents"
          hint="A saved preset: system prompt, model, and the tools, skills and MCP servers it may use."
          action={<NewAgentButton />}
        />
        <RegistryGrid
          error={error}
          href={(id) => `/agents/${id}`}
          icon={Bot}
          tone="sky"
          empty={{
            title: "No agents yet",
            description:
              "An agent is a saved preset: system prompt, model, and the tools it may use.",
            action: <NewAgentButton />,
          }}
          rows={agents.map((agent) => ({
            id: agent.id,
            title: agent.name,
            kind: agent.model ?? agent.slug,
            meta: agent.description,
            enabled: agent.enabled,
          }))}
        />
      </div>
    </PageBody>
  );
}
