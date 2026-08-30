"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { CheckboxList } from "@/components/registry/fields";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import { newNodeId } from "@/lib/graph-serde";
import { agentsApi } from "@/lib/registry-api";
import type { Agent, AgentSummary } from "@/lib/registry-types";
import { createWorkflow } from "@/lib/workflow-api";
import type { AgentNodeConfig, WorkflowNode } from "@/lib/workflow-types";

/**
 * "New workflow", with an optional agent picker.
 *
 * Replaced a window.prompt that only asked for a name. Each agent picked here
 * becomes its own, fully unconnected, agent-step node — connecting them is
 * done afterward in the editor (drag on the canvas, or the Connect tab), not
 * here, so this never has to guess at an execution order.
 */
export default function NewWorkflowButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("Untitled workflow");
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  function onOpenChange(next: boolean) {
    if (busy) return;
    setOpen(next);
    if (next) {
      setName("Untitled workflow");
      setSelectedAgentIds([]);
      agentsApi.list().then(setAgents).catch(() => setAgents([]));
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      toast.warning("Give it a name first.");
      return;
    }

    setBusy(true);
    try {
      const fullAgents = await Promise.all(
        selectedAgentIds.map((id) => agentsApi.get(id)),
      );
      const nodes: WorkflowNode[] = fullAgents.map((agent: Agent, i) => ({
        id: newNodeId("agent"),
        type: "agent",
        label: agent.name,
        position: { x: 120, y: 80 + i * 140 },
        config: {
          prompt: agent.systemPrompt,
          tools: agent.toolNames.length > 0 ? agent.toolNames : null,
          max_iterations: agent.maxIterations,
          on_error: "fail",
          model: agent.model,
        } satisfies AgentNodeConfig,
      }));

      const workflow = await createWorkflow(
        trimmed,
        nodes.length > 0 ? { nodes, edges: [] } : undefined,
      );
      router.push(`/workflows/${workflow.id}`);
      setOpen(false);
      toast.success(`Workflow "${trimmed}" created`);
    } catch (err) {
      toast.error({ title: "Could not create workflow", description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button type="button" size="sm" onClick={() => onOpenChange(true)}>
        New workflow
      </Button>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>New workflow</DialogTitle>
              <DialogDescription>
                Name it, and optionally start from one or more existing agents.
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-4 py-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="workflow-name" className="text-xs font-medium">
                  Name
                </Label>
                <Input
                  id="workflow-name"
                  autoFocus
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  disabled={busy}
                />
              </div>

              <CheckboxList
                label="Agents to include"
                hint="Each one becomes its own step, unconnected — wire them up after creating the workflow."
                options={agents.map((a) => ({
                  value: a.id,
                  label: a.name,
                  description: a.description ?? a.slug,
                }))}
                selected={selectedAgentIds}
                onChange={setSelectedAgentIds}
                emptyMessage="No agents in the registry yet — you can add nodes manually after creating the workflow."
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={busy || !name.trim()}>
                {busy ? "Creating…" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
