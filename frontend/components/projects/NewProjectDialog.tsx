"use client";

import { ArrowLeft, FolderPlus, ImportIcon, Loader2, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import GithubRepoPicker from "@/components/projects/GithubRepoPicker";
import ResourceCard from "@/components/registry/ResourceCard";
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
import type { Credential } from "@/lib/credential-types";
import { projectsApi } from "@/lib/project-api";
import type { CloneEvent, RemoteRepo } from "@/lib/project-types";

type Step = "choose" | "blank" | "github";
type Phase = "idle" | "working" | "failed";

/**
 * The terminal-style log both creation paths share once they start working.
 * The failure itself is reported as a toast — this stays a pure progress
 * transcript, so the last line still shown is wherever the process got to.
 */
function ProgressLog({ lines, working }: { lines: string[]; working: boolean }) {
  return (
    <div className="flex flex-col gap-3 py-2">
      <div className="rounded-lg border bg-muted/30 p-3 font-mono text-xs">
        {lines.map((line, index) => (
          <div key={index} className="flex items-start gap-2">
            <span className="text-muted-foreground">›</span>
            <span>{line}</span>
          </div>
        ))}
        {working && (
          <div className="mt-1 flex items-center gap-2 text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            working…
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Start a project two ways: empty, or cloned from GitHub.
 *
 * The dialog stays open through creation rather than navigating away
 * immediately: setting up a working tree is the part that can fail (a bad
 * token, a missing repo, no network for the GitHub path — disk or git
 * themselves for the blank one), and a failure needs somewhere to be
 * reported. The project row exists before that step runs, so a failure leaves
 * something to retry rather than nothing at all.
 */
export default function NewProjectDialog({ credentials }: { credentials: Credential[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("choose");
  const [phase, setPhase] = useState<Phase>("idle");
  const [lines, setLines] = useState<string[]>([]);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  function reset() {
    setStep("choose");
    setPhase("idle");
    setLines([]);
    setName("");
    setDescription("");
  }

  function onOpenChange(next: boolean) {
    // Closing mid-setup would leave the operator with no idea whether it
    // finished, so the dialog is locked while a creation is in flight.
    if (phase === "working") return;
    setOpen(next);
    if (next) reset();
  }

  async function createBlank() {
    const trimmed = name.trim();
    if (!trimmed) return;

    setPhase("working");
    setLines(["Creating the project…"]);

    try {
      const project = await projectsApi.create({
        kind: "blank",
        name: trimmed,
        description: description.trim() || undefined,
      });

      setLines((prev) => [...prev, "Setting up a git repository and README…"]);
      await projectsApi.init(project.id);

      setOpen(false);
      router.push(`/projects/${project.id}/vscode`);
    } catch (err) {
      toast.error({ title: "Could not create the project", description: (err as Error).message });
      setPhase("failed");
      router.refresh();
    }
  }

  async function importRepo(repo: RemoteRepo, credentialId: string) {
    setPhase("working");
    setLines([`Creating project for ${repo.full_name}…`]);

    try {
      const project = await projectsApi.create({
        kind: "github",
        name: repo.name,
        repoOwner: repo.owner,
        repoName: repo.name,
        repoUrl: repo.clone_url,
        repoId: repo.id,
        defaultBranch: repo.default_branch,
        visibility: repo.private ? "private" : "public",
        credentialId,
      });

      let failed: string | null = null;
      await projectsApi.clone(project.id, (event: CloneEvent) => {
        if (event.type === "clone_progress") {
          setLines((prev) => [...prev, event.message]);
        } else if (event.type === "clone_error") {
          failed = event.message;
        }
      });

      if (failed) {
        toast.error({ title: "Clone failed", description: failed });
        setPhase("failed");
        router.refresh();
        return;
      }

      setOpen(false);
      router.push(`/projects/${project.id}/vscode`);
    } catch (err) {
      toast.error({ title: "Clone failed", description: (err as Error).message });
      setPhase("failed");
      router.refresh();
    }
  }

  const showingProgress = phase === "working" || phase === "failed";

  const footer =
    step === "choose" ? (
      <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
        Cancel
      </Button>
    ) : phase === "failed" ? (
      <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
        Close
      </Button>
    ) : step === "blank" && phase === "idle" ? (
      <Button type="button" disabled={!name.trim()} onClick={() => void createBlank()}>
        Create project
      </Button>
    ) : null;

  return (
    <>
      <Button type="button" size="sm" onClick={() => onOpenChange(true)}>
        <Plus />
        New project
      </Button>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl">
          {/* Back leads the card rather than trailing it: it walks the wizard
              backwards, which is navigation, and putting it in the footer put
              it beside "Create project" as though the two were alternatives. */}
          {step !== "choose" && phase === "idle" && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="-mb-2 -ml-1.5 w-fit text-muted-foreground"
              onClick={() => setStep("choose")}
            >
              <ArrowLeft />
              Back
            </Button>
          )}

          <DialogHeader>
            <DialogTitle>
              {step === "choose" && "New project"}
              {step === "blank" && "Blank project"}
              {step === "github" && "Import from GitHub"}
            </DialogTitle>
            <DialogDescription>
              {step === "choose" &&
                "Start from nothing, or bring in a repository you already have."}
              {step === "blank" &&
                "A git repository with a README, ready to open in the editor."}
              {step === "github" &&
                "Clone a repository into the harness workspace so the agent can work inside it."}
            </DialogDescription>
          </DialogHeader>

          {step === "choose" && (
            <div className="grid grid-cols-2 gap-3 py-2">
              <button type="button" className="text-left" onClick={() => setStep("blank")}>
                <ResourceCard
                  icon={FolderPlus}
                  tone="sky"
                  title="Blank project"
                  kind="Start empty"
                  meta="Git-initialized with a README, opens straight in the editor."
                />
              </button>
              <button type="button" className="text-left" onClick={() => setStep("github")}>
                <ResourceCard
                  icon={ImportIcon}
                  tone="purple"
                  title="Import from GitHub"
                  kind="Clone a repository"
                  meta="Pick a repo from a connected account and clone it in."
                />
              </button>
            </div>
          )}

          {step === "blank" &&
            (showingProgress ? (
              <ProgressLog lines={lines} working={phase === "working"} />
            ) : (
              <div className="flex flex-col gap-3 py-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="proj-name" className="text-xs font-medium">
                    Name
                  </Label>
                  <Input
                    id="proj-name"
                    autoFocus
                    value={name}
                    placeholder="my-new-project"
                    onChange={(event) => setName(event.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="proj-desc" className="text-xs font-medium">
                    Description{" "}
                    <span className="font-normal text-muted-foreground">(optional)</span>
                  </Label>
                  <Input
                    id="proj-desc"
                    value={description}
                    placeholder="A brief description of your project"
                    onChange={(event) => setDescription(event.target.value)}
                  />
                </div>
              </div>
            ))}

          {step === "github" &&
            (showingProgress ? (
              <ProgressLog lines={lines} working={phase === "working"} />
            ) : (
              <GithubRepoPicker credentials={credentials} onPick={importRepo} />
            ))}

          {/* Nothing to show while a creation is in flight — the log is the
              whole dialog then, and an empty footer would still take a row. */}
          {footer && <DialogFooter>{footer}</DialogFooter>}
        </DialogContent>
      </Dialog>
    </>
  );
}
