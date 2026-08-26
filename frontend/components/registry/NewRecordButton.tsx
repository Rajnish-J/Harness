"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

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
import { slugify } from "@/lib/registry-types";

/**
 * "New X" for the three registries.
 *
 * This replaced a window.prompt + window.alert pair. The prompt could not show
 * the slug that was about to be minted, and — the reason it had to go — it had
 * nowhere to put a 409. A duplicate name meant an alert, a dismissed dialog,
 * and retyping from scratch. Here the conflict lands next to the input that
 * caused it and the name is still there to edit.
 */
export default function NewRecordButton({
  label,
  promptText,
  defaultName,
  create,
  hrefFor,
  showSlug = true,
}: {
  label: string;
  promptText: string;
  defaultName: string;
  create: (name: string) => Promise<{ id: string }>;
  hrefFor: (id: string) => string;
  /** MCP servers are keyed by name, not slug, so they suppress the preview. */
  showSlug?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(defaultName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset through the open handler rather than an effect: this is an event, and
  // setState inside useEffect is a lint error in this repo.
  function onOpenChange(next: boolean) {
    if (busy) return;
    setOpen(next);
    if (next) {
      setName(defaultName);
      setError(null);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Give it a name first.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const created = await create(trimmed);
      router.push(hrefFor(created.id));
      setOpen(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const slug = slugify(name);

  return (
    <>
      <Button type="button" size="sm" onClick={() => onOpenChange(true)}>
        <Plus />
        {label}
      </Button>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          {/* A real form, so Enter submits without a keydown handler. */}
          <form onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>{label}</DialogTitle>
              <DialogDescription>{promptText}</DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-2 py-4">
              <Label htmlFor="record-name" className="text-xs font-medium">
                Name
              </Label>
              <Input
                id="record-name"
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={busy}
              />
              {showSlug && slug && (
                <p className="font-mono text-[11px] text-muted-foreground">
                  {hrefFor(slug)}
                </p>
              )}
              {error && (
                <p className="text-xs text-destructive" role="alert">
                  {error}
                </p>
              )}
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
