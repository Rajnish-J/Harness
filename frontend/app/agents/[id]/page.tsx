import { notFound } from "next/navigation";

import AgentEditor from "@/components/agents/AgentEditor";
import type { Agent } from "@/lib/registry-types";
import { getAgent } from "@/lib/server/registry-service";

export const dynamic = "force-dynamic";

// Next 16: params arrive as a Promise.
export default async function AgentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const row = await getAgent(id);
  if (!row) notFound();

  const agent: Agent = {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };

  return <AgentEditor agent={agent} />;
}
