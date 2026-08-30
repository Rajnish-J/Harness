"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import CredentialPicker from "@/components/projects/CredentialPicker";
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
import type { ProjectListRow } from "@/lib/project-types";

/**
 * Rename a project, re-link its credential, or change the branch it defaults to.
 *
 * The three fields are exactly what `PATCH /api/projects/{id}` accepts, and the
 * route explains why it accepts no more: the repo coordinates describe what was
 * cloned and `cloneStatus` is Python's to write, so anything else here could put
 * the row and the checkout on disk into disagreement. `slug` is frozen at
 * creation — it is the unique key — which is why the name and the URL can drift
 * apart and that is fine.
 */
export default function EditProjectDialog({
  project,
  credentials,
  onOpenChange,
}: {
  project: ProjectListRow;
  credentials: Credential[];
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  // Seeded once, from props. ProjectsExplorer mounts this under `key={id}`, so
  // opening a different project remounts rather than re-seeding — the React
  // way to reset state on identity change, and it keeps setState out of an
  // effect where it would cascade a render.
  const [name, setName] = useState(project.name);
  const [credentialId, setCredentialId] = useState<string | null>(
    project.credentialId,
  );
  const [defaultBranch, setDefaultBranch] = useState(project.defaultBranch);
  const [saving, setSaving] = useState(false);

  const trimmed = name.trim();
  const dirty =
    trimmed !== project.name ||
    credentialId !== project.credentialId ||
    defaultBranch.trim() !== project.defaultBranch;

  async function save() {
    if (!trimmed) return;
    setSaving(true);
    try {
      await projectsApi.update(project.id, {
        name: trimmed,
        credentialId,
        defaultBranch: defaultBranch.trim() || project.defaultBranch,
      });
      toast.success(`Saved “${trimmed}”.`);
      onOpenChange(false);
      // The list is server-rendered, so a client-side save is invisible to it
      // until its cache is invalidated.
      router.refresh();
    } catch (error) {
      toast.error({
        title: "Could not save the project",
        description: (error as Error).message,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit project</DialogTitle>
          <DialogDescription>
            Changes what the harness records about this project. It does not
            touch the checkout on disk.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="project-name" className="text-xs font-medium">
              Name
            </Label>
            <Input
              id="project-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={saving}
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="project-branch" className="text-xs font-medium">
              Default branch
            </Label>
            <Input
              id="project-branch"
              value={defaultBranch}
              onChange={(event) => setDefaultBranch(event.target.value)}
              disabled={saving}
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              Where new branches start from. Does not check out a branch —
              currently on{" "}
              <span className="font-mono">
                {project.currentBranch ?? "nothing yet"}
              </span>
              .
            </p>
          </div>

          <CredentialPicker
            credentials={credentials}
            value={credentialId}
            onChange={setCredentialId}
            disabled={saving}
            allowNone
          />
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={saving || !dirty || !trimmed}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
