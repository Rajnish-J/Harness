"use client";

import { ArrowLeft, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

const WIDTHS = {
  prose: "max-w-3xl",
  wide: "max-w-6xl",
} as const;

/**
 * Save / delete chrome shared by the three registry editors.
 *
 * The toolbar sits inside the page rather than in AppHeader: what's here is
 * state belonging to one record, not app navigation. Same call the workflow
 * editor makes with its Save button.
 *
 * The max-width lands on the header row and the content div, not on this
 * component's own root or the ScrollArea — same split PageBody makes, for the
 * same reason. Clamping the root centred the whole editor as a narrow slab in
 * the middle of the main area: the header's bottom border stopped short of the
 * page edges and the scrollbar sat beside the column instead of at the true
 * edge, leaving dead strips down both sides on any wide viewport.
 *
 * `width` mirrors PageBody's prop of the same name and defaults to the prose
 * column. An editor opts into `wide` when its fields are not a single stack of
 * short text inputs — MCP carries key/value tables for env and headers, which
 * need the room for a name and a value side by side.
 */
export default function EditorShell({
  title,
  backHref,
  dirty,
  onSave,
  onDelete,
  deleteLabel,
  actions,
  children,
  width = "prose",
}: {
  title: string;
  /**
   * The list page this record belongs to. A hardcoded link rather than
   * router.back(): a detail page reached by direct link or refresh has no
   * useful history entry behind it, and Back must still land on the list.
   */
  backHref: string;
  dirty: boolean;
  onSave: () => Promise<void>;
  onDelete: () => Promise<void>;
  deleteLabel: string;
  /** Record-specific actions, shown left of Delete/Save. */
  actions?: React.ReactNode;
  children: React.ReactNode;
  width?: keyof typeof WIDTHS;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"save" | "delete" | null>(null);

  async function save() {
    setBusy("save");
    try {
      await onSave();
      // The list pages are server-rendered, so a client-side save is invisible
      // to them until their cache is invalidated.
      router.refresh();
      toast.success(`${title} saved`);
    } catch (err) {
      toast.error({ title: "Save failed", description: (err as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!window.confirm(deleteLabel)) return;
    setBusy("delete");
    try {
      await onDelete();
      router.refresh();
    } catch (err) {
      toast.error({ title: "Delete failed", description: (err as Error).message });
      setBusy(null);
    }
  }

  return (
    <div className="flex h-full w-full flex-col font-sans">
      <div className="shrink-0 border-b px-4 py-2.5">
        <div
          className={cn(
            "mx-auto flex w-full items-center gap-3",
            WIDTHS[width],
          )}
        >
          <Button asChild variant="ghost" size="sm" className="-ml-2 h-7 px-2">
            <Link href={backHref} aria-label="Back to list">
              <ArrowLeft className="size-3.5" />
              Back
            </Link>
          </Button>
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
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className={cn("mx-auto w-full p-4", WIDTHS[width])}>
          <div className="flex flex-col gap-5">{children}</div>
        </div>
      </ScrollArea>
    </div>
  );
}
