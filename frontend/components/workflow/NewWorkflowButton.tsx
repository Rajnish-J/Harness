"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { createWorkflow } from "@/lib/workflow-api";

export default function NewWorkflowButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function create() {
    const name = window.prompt("Name this workflow", "Untitled workflow");
    if (!name) return;
    setBusy(true);
    try {
      const workflow = await createWorkflow(name);
      router.push(`/workflows/${workflow.id}`);
    } catch (error) {
      window.alert(`Could not create the workflow: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={create}
      disabled={busy}
      className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-50 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
    >
      {busy ? "Creating…" : "New workflow"}
    </button>
  );
}
