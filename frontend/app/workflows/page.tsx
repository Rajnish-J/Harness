import Link from "next/link";

import PageBody from "@/components/shell/PageBody";
import NewWorkflowButton from "@/components/workflow/NewWorkflowButton";
import { describeDbError } from "@/lib/server/db-error";
import { listWorkflows } from "@/lib/server/workflow-service";

export const dynamic = "force-dynamic";

export default async function WorkflowsPage() {
  let workflows: Awaited<ReturnType<typeof listWorkflows>> = [];
  let error: string | null = null;

  try {
    workflows = await listWorkflows();
  } catch (err) {
    error = describeDbError(err);
  }

  return (
    <PageBody toolbar={<NewWorkflowButton />}>
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          Could not load workflows: {error}
        </div>
      )}

      {!error && workflows.length === 0 && (
        <p className="py-16 text-center text-sm text-zinc-400">
          No workflows yet. Create one to get started.
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {workflows.map((workflow) => (
          <li key={workflow.id}>
            <Link
              href={`/workflows/${workflow.id}`}
              className="flex items-center justify-between rounded-lg border border-black/[.10] px-3 py-2.5 transition-colors hover:bg-black/[.03] dark:border-white/[.14] dark:hover:bg-white/[.05]"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{workflow.name}</p>
                {workflow.description && (
                  <p className="truncate text-xs text-zinc-500">
                    {workflow.description}
                  </p>
                )}
              </div>
              <span className="shrink-0 font-mono text-[10px] text-zinc-400">
                v{workflow.version}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </PageBody>
  );
}
