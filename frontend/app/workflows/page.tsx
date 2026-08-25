import Link from "next/link";

import NewWorkflowButton from "@/components/workflow/NewWorkflowButton";
import { listWorkflows } from "@/lib/server/workflow-service";

export const dynamic = "force-dynamic";

export default async function WorkflowsPage() {
  let workflows: Awaited<ReturnType<typeof listWorkflows>> = [];
  let error: string | null = null;

  try {
    workflows = await listWorkflows();
  } catch (err) {
    error = (err as Error).message;
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col font-sans">
      <header className="flex items-center justify-between border-b border-black/[.08] px-4 py-3 dark:border-white/[.12]">
        <div>
          <h1 className="text-sm font-semibold tracking-tight">Workflows</h1>
          <p className="text-[11px] text-zinc-400">
            Multi-step agent pipelines on a canvas
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/"
            className="rounded-lg border border-black/[.10] px-3 py-1.5 text-xs dark:border-white/[.14]"
          >
            Chat
          </Link>
          <NewWorkflowButton />
        </div>
      </header>

      <div className="flex-1 p-4">
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
      </div>
    </div>
  );
}
