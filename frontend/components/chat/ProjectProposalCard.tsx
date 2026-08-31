"use client";

import { Check, Loader2, Rocket, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useChatPreset } from "@/components/chat/ChatPresetProvider";
import { useChatSession } from "@/components/chat/ChatSessionProvider";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { projectsApi } from "@/lib/project-api";
import type { TranscriptItem } from "@/lib/types";

type Proposal = Extract<TranscriptItem, { kind: "project_proposal" }>;

/**
 * A proposal to create a new blank project, awaiting a human verdict.
 *
 * The model never creates anything — calling propose_create_project only
 * parks the turn (see backend/app/agent/loop.py). "Create it" does the actual
 * work here, with the same two calls NewProjectDialog's blank path already
 * makes, and only tells the backend "approved" once both succeed — so the
 * parked turn is never told yes before the project genuinely exists.
 */
export default function ProjectProposalCard({ item }: { item: Proposal }) {
  const router = useRouter();
  const { resolveApprovals, streaming } = useChatSession();
  const { preset } = useChatPreset();
  const [working, setWorking] = useState(false);

  if (item.decision) {
    return (
      <p className="px-2 font-mono text-[11px] text-muted-foreground">
        {item.decision === "approved" ? "creating project…" : "not now"} ·{" "}
        {item.name}
      </p>
    );
  }

  async function accept() {
    setWorking(true);
    try {
      const project = await projectsApi.create({
        kind: "blank",
        name: item.name.trim(),
        description: item.description.trim() || undefined,
      });
      await projectsApi.init(project.id);
      // Fire-and-forget: this resolves the parked backend turn so the model
      // can close out the conversation, but navigation does not wait on it —
      // the global session persists in the root layout regardless of route.
      void resolveApprovals([{ id: item.id, approved: true }], preset);
      router.push(`/projects/${project.id}/vscode`);
    } catch (err) {
      toast.error({
        title: "Could not create the project",
        description: (err as Error).message,
      });
      setWorking(false);
    }
  }

  const decline = () =>
    void resolveApprovals([{ id: item.id, approved: false }], preset);

  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-xs font-medium">
        <Rocket className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
        Start a new project: <span className="font-mono">{item.name}</span>?
      </p>

      {item.description && (
        <p className="mt-1 px-0.5 text-[11px] text-muted-foreground">
          {item.description}
        </p>
      )}

      <div className="mt-2 flex gap-2">
        <Button
          type="button"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          disabled={streaming || working}
          onClick={() => void accept()}
        >
          {working ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Check className="size-3.5" />
          )}
          Create it
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 text-xs"
          disabled={streaming || working}
          onClick={decline}
        >
          <X className="size-3.5" />
          Not now
        </Button>
      </div>
    </div>
  );
}
