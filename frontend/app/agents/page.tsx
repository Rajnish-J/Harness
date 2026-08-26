import NewAgentButton from "@/components/agents/NewAgentButton";
import RegistryList from "@/components/registry/RegistryList";
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
    <PageBody toolbar={<NewAgentButton />}>
      <RegistryList
        error={error}
        href={(id) => `/agents/${id}`}
        emptyMessage="No agents yet. An agent is a saved preset: system prompt, model, and the tools it may use."
        rows={agents.map((agent) => ({
          id: agent.id,
          title: agent.name,
          subtitle: agent.description,
          badge: agent.model ?? agent.slug,
          enabled: agent.enabled,
        }))}
      />
    </PageBody>
  );
}
