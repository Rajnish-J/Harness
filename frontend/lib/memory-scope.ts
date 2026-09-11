import type { Memory } from "@/lib/memory-api";

/**
 * Which of the three tiers a memory belongs to.
 *
 * `scoped_session_id` is the only field that answers this: `session_id` is
 * provenance and is stamped on every agent-written row whatever its scope, so
 * reading that instead would label every agent memory "conversation".
 *
 * Shared rather than repeated as a ternary in each card, because a two-state
 * `project_id ? … : …` is exactly what this tier makes wrong, and one of them
 * left behind is a row quietly mislabelled as broader than it is.
 */
export type MemoryScope = "global" | "project" | "conversation";

export function memoryScope(memory: Memory): MemoryScope {
  if (memory.scoped_session_id) return "conversation";
  return memory.project_id ? "project" : "global";
}

/** Long form, for a card's own sub-line. */
export const SCOPE_LABEL: Record<MemoryScope, string> = {
  global: "Global",
  project: "This project",
  conversation: "This chat only",
};

/** Short form, where the surrounding text already supplies the context. */
export const SCOPE_SHORT_LABEL: Record<MemoryScope, string> = {
  global: "Global",
  project: "Project",
  conversation: "Chat",
};

/** sky = global, purple = project, amber = one conversation. */
export const SCOPE_CLASS: Record<MemoryScope, string> = {
  global: "bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  project: "bg-purple-50 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300",
  conversation: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
};
