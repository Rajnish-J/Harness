"use client";

import { useState } from "react";

import { SegmentedField, TextAreaField, TextField } from "@/components/registry/fields";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import {
  MEMORY_KINDS,
  MEMORY_KIND_HINTS,
  memoryApi,
  type Memory,
  type MemoryKind,
} from "@/lib/memory-api";

/**
 * Write or edit one memory by hand.
 *
 * Scope is fixed, not a field: creating uses whatever scope the browser is
 * filtered to, and an existing memory cannot be moved between scopes — its
 * slug is unique per scope, so a move is a delete plus a re-create rather than
 * an edit. `kind` stays editable because it is only a label.
 */
export default function MemoryDialog({
  memory,
  projectId,
  projectName,
  onOpenChange,
  onSaved,
}: {
  /** Null creates a new memory; a row edits that one. */
  memory: Memory | null;
  /** Scope for a new memory. Null is global. */
  projectId: string | null;
  projectName: string | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(memory?.title ?? "");
  const [content, setContent] = useState(memory?.content ?? "");
  const [kind, setKind] = useState<MemoryKind>(memory?.kind ?? "fact");
  const [saving, setSaving] = useState(false);

  const editing = memory !== null;
  const scopeLabel = editing
    ? memory.project_id
      ? "this project"
      : "every project and chat"
    : projectId
      ? (projectName ?? "this project")
      : "every project and chat";

  const trimmedTitle = title.trim();
  const trimmedContent = content.trim();
  const dirty = editing
    ? trimmedTitle !== memory.title ||
      trimmedContent !== memory.content ||
      kind !== memory.kind
    : trimmedTitle.length > 0 && trimmedContent.length > 0;

  async function save() {
    if (!trimmedTitle || !trimmedContent) return;
    setSaving(true);
    try {
      if (editing) {
        await memoryApi.update(memory.id, {
          title: trimmedTitle,
          content: trimmedContent,
          kind,
        });
      } else {
        await memoryApi.create({
          project_id: projectId,
          kind,
          title: trimmedTitle,
          content: trimmedContent,
        });
      }
      toast.success(`Saved “${trimmedTitle}”.`);
      onOpenChange(false);
      onSaved();
    } catch (error) {
      toast.error({
        title: "Could not save this memory",
        description: (error as Error).message,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit memory" : "New memory"}</DialogTitle>
          <DialogDescription>
            Applies to {scopeLabel}. The agent reads this at the start of every
            turn, in every session — including ones already open.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <TextField
            label="Title"
            value={title}
            onChange={setTitle}
            placeholder="Always run tests before committing"
          />

          <SegmentedField
            label="Kind"
            hint={MEMORY_KIND_HINTS[kind]}
            options={MEMORY_KINDS.map((k) => ({ value: k, label: k }))}
            value={kind}
            onChange={setKind}
          />

          <TextAreaField
            label="Memory"
            hint="The rule or fact, why it matters, and when it applies. Markdown is fine."
            value={content}
            onChange={setContent}
            rows={8}
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
          <Button
            size="sm"
            onClick={save}
            disabled={saving || !dirty || !trimmedTitle || !trimmedContent}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
