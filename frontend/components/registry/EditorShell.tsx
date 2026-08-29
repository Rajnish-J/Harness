"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

/**
 * Save / delete chrome shared by the three registry editors.
 *
 * The toolbar sits inside the page rather than in AppHeader: what's here is
 * state belonging to one record, not app navigation. Same call the workflow
 * editor makes with its Save button.
 */
export default function EditorShell({
  title,
  dirty,
  onSave,
  onDelete,
  deleteLabel,
  actions,
  children,
}: {
  title: string;
  dirty: boolean;
  onSave: () => Promise<void>;
  onDelete: () => Promise<void>;
  deleteLabel: string;
  /** Record-specific actions, shown left of Delete/Save. */
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"save" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy("save");
    setError(null);
    try {
      await onSave();
      // The list pages are server-rendered, so a client-side save is invisible
      // to them until their cache is invalidated.
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!window.confirm(deleteLabel)) return;
    setBusy("delete");
    setError(null);
    try {
      await onDelete();
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col font-sans">
      <div className="flex shrink-0 items-center gap-3 border-b px-4 py-2.5">
        <h2 className="truncate text-sm font-semibold">{title}</h2>
        {dirty && <span className="text-[11px] text-amber-600">unsaved</span>}
        <div className="ml-auto flex items-center gap-2">
          {actions}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={remove}
            disabled={busy !== null}
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 />
            {busy === "delete" ? "Deleting…" : "Delete"}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={save}
            disabled={busy !== null || !dirty}
          >
            {busy === "save" ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="p-4">
          {error && (
            <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-700 dark:text-red-300">
              {error}
            </div>
          )}
          <div className="flex flex-col gap-5">{children}</div>
        </div>
      </ScrollArea>
    </div>
  );
}
