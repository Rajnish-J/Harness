import { notFound } from "next/navigation";

import WorkflowEditor from "@/components/workflow/WorkflowEditor";
import { getWorkflow } from "@/lib/server/workflow-service";
import { EMPTY_GRAPH, type Workflow } from "@/lib/workflow-types";

// Next 16: params arrive as a Promise.
export default async function WorkflowPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const row = await getWorkflow(id);
  if (!row || row.archivedAt) notFound();

  const workflow: Workflow = {
    id: row.id,
    name: row.name,
    description: row.description,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    graph: row.graph ?? EMPTY_GRAPH,
  };

  return <WorkflowEditor workflow={workflow} />;
}
