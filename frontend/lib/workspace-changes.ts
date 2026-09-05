import type { TranscriptItem } from "@/lib/types";

/** A file this conversation touched, and how. */
export type WorkspaceChange = {
  path: string;
  action: "created" | "edited" | "deleted" | "moved";
  /** How many tool calls touched it, so a heavily-edited file reads as such. */
  touches: number;
};

/**
 * Which argument on each write tool names the file it wrote.
 *
 * copy_file and move_file are recorded at their destination: the source is
 * where the bytes came from, the destination is what the project would adopt.
 */
const WRITE_TOOLS: Record<
  string,
  { arg: string; action: WorkspaceChange["action"] }
> = {
  write_file: { arg: "path", action: "created" },
  edit_file: { arg: "path", action: "edited" },
  delete_file: { arg: "path", action: "deleted" },
  move_file: { arg: "destination", action: "moved" },
  copy_file: { arg: "destination", action: "created" },
};

/** Alternate argument names, since the tools are not perfectly uniform. */
const FALLBACK_ARGS = ["path", "destination", "dest", "target", "file_path"];

function pathFrom(args: Record<string, unknown>, preferred: string): string | null {
  for (const key of [preferred, ...FALLBACK_ARGS]) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/**
 * The files this conversation changed, derived from its own transcript.
 *
 * Read off the rendered transcript rather than asked of the backend: every tool
 * call already carries its arguments (see lib/transcript.ts), and a live stream
 * and a repainted history produce the same `step` items. An endpoint would have
 * to re-derive exactly this from project_chat_messages.
 *
 * Only successful calls count -- a write that errored changed nothing, and
 * offering to adopt it would promise a file that is not there.
 */
export function workspaceChanges(items: TranscriptItem[]): WorkspaceChange[] {
  const seen = new Map<string, WorkspaceChange>();

  for (const item of items) {
    if (item.kind !== "step" || item.status !== "ok") continue;

    const spec = WRITE_TOOLS[item.name];
    if (!spec) continue;

    const path = pathFrom(item.arguments, spec.arg);
    if (!path) continue;

    const existing = seen.get(path);
    if (existing) {
      // Last action wins: a file created then deleted is deleted. Insertion
      // order is preserved, so the list still reads in the order work happened.
      existing.action = spec.action;
      existing.touches += 1;
    } else {
      seen.set(path, { path, action: spec.action, touches: 1 });
    }

    // A move leaves nothing at the source.
    if (item.name === "move_file") {
      const from = typeof item.arguments.source === "string"
        ? item.arguments.source
        : typeof item.arguments.src === "string"
          ? item.arguments.src
          : null;
      if (from) seen.delete(from.trim());
    }
  }

  // Deleted files are not adoptable -- there is nothing to copy.
  return [...seen.values()].filter((change) => change.action !== "deleted");
}
