/**
 * Browser client for cross-session memory.
 *
 * Points at API_BASE (the Python harness) rather than a same-origin Next
 * route, unlike the skills/agents registries: `memory_entries` is written by
 * the agent's own `remember` tool mid-turn, so the backend is its single
 * writer and the admin surface goes through the same door. Same split
 * project-api.ts documents for its clone/discovery calls.
 */

import { API_BASE } from "./api";
import { flags } from "./flags";
import {
  byUpdatedAtDesc,
  inScope,
  mockPreview,
  MOCK_MEMORY_SESSIONS,
} from "./mock/memory";
import { assertUnique, mockId, mockNow, mockStore } from "./mock/store";

export type MemoryKind = "preference" | "feedback" | "fact" | "reference";

export const MEMORY_KINDS: MemoryKind[] = [
  "preference",
  "feedback",
  "fact",
  "reference",
];

/** What each kind is for, shown in the admin UI so the taxonomy is usable. */
export const MEMORY_KIND_HINTS: Record<MemoryKind, string> = {
  preference: "How the user likes to work",
  feedback: "A correction or confirmed approach, and why",
  fact: "Something true about this project or its domain",
  reference: "Where information lives, e.g. an issue tracker",
};

export type Memory = {
  id: string;
  project_id: string | null;
  kind: MemoryKind;
  slug: string;
  title: string;
  content: string;
  /** "agent" when the model wrote it via `remember`, "human" from this page. */
  source: string;
  session_id: string | null;
  created_at: string;
  updated_at: string;
};

export type MemoryInput = {
  project_id?: string | null;
  kind: MemoryKind;
  slug?: string;
  title: string;
  content: string;
};

export type MemoryPatch = {
  title?: string;
  content?: string;
  kind?: MemoryKind;
};

/** The conversation a memory was written during, resolved to something
 *  readable. Absent from an overview when that chat has since been deleted. */
export type MemorySession = {
  session_id: string;
  title: string;
  updated_at: string;
  message_count: number;
};

/** Every active memory in every scope, plus the sessions behind them. Two flat
 *  lists rather than nesting: several memories usually share one session. */
export type MemoryOverview = {
  memories: Memory[];
  sessions: MemorySession[];
};

/** The `<memories>` block a turn in one scope would actually receive. */
export type MemoryPreview = {
  project_id: string | null;
  /** Empty when nothing is in scope — there is no block at all then. */
  block: string;
  char_count: number;
  memory_count: number;
  max_system_prompt_chars: number;
};

const BASE = `${API_BASE}/api/memory`;

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as { detail?: string }).detail ?? `Request failed: ${res.status}`,
    );
  }
  return res.json() as Promise<T>;
}

/** Derive a slug the way the backend's `slugify` does, for mock writes. */
function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.slice(0, 80) || "note";
}

export const memoryApi = {
  /**
   * Active memory in scope. Global rows always come back; a `projectId` adds
   * that project's on top — the same union the agent's system prompt gets.
   */
  list: async (projectId?: string | null, signal?: AbortSignal): Promise<Memory[]> => {
    if (flags.mockMemory) {
      return byUpdatedAtDesc(inScope([...mockStore().memory.values()], projectId));
    }

    const query = projectId ? `?project_id=${encodeURIComponent(projectId)}` : "";
    return json(await fetch(`${BASE}${query}`, { cache: "no-store", signal }));
  },

  /** Every scope at once, for the insights page. Never used to build a prompt. */
  overview: async (signal?: AbortSignal): Promise<MemoryOverview> => {
    if (flags.mockMemory) {
      const memories = byUpdatedAtDesc([...mockStore().memory.values()]);
      const live = new Set(memories.map((m) => m.session_id).filter(Boolean));
      return {
        memories,
        // Only sessions that still exist AND still have a memory pointing at
        // them, so deleting the last memory of a session drops it from the view.
        sessions: MOCK_MEMORY_SESSIONS.filter((s) => live.has(s.session_id)),
      };
    }

    return json(await fetch(`${BASE}/overview`, { cache: "no-store", signal }));
  },

  /** The composed `<memories>` block for one scope, as the model receives it. */
  preview: async (
    projectId?: string | null,
    signal?: AbortSignal,
  ): Promise<MemoryPreview> => {
    if (flags.mockMemory) {
      return mockPreview([...mockStore().memory.values()], projectId);
    }

    const query = projectId ? `?project_id=${encodeURIComponent(projectId)}` : "";
    return json(await fetch(`${BASE}/preview${query}`, { cache: "no-store", signal }));
  },

  create: async (input: MemoryInput): Promise<Memory> => {
    if (flags.mockMemory) {
      const store = mockStore().memory;
      const slug = input.slug?.trim() || slugify(input.title);
      const projectId = input.project_id ?? null;
      // The real table has two partial unique indexes on (scope, slug); this
      // is the same constraint expressed the only way a Map can.
      assertUnique(
        [...store.values()].some(
          (row) => row.slug === slug && row.project_id === projectId,
        ),
        "memory slug",
      );
      const now = mockNow();
      const created: Memory = {
        id: mockId(),
        project_id: projectId,
        kind: input.kind,
        slug,
        title: input.title,
        content: input.content,
        source: "human",
        session_id: null,
        created_at: now,
        updated_at: now,
      };
      store.set(created.id, created);
      return created;
    }

    return json(
      await fetch(BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
    );
  },

  update: async (id: string, patch: MemoryPatch): Promise<Memory> => {
    if (flags.mockMemory) {
      const store = mockStore().memory;
      const existing = store.get(id);
      if (!existing) throw new Error("Memory not found.");
      const next: Memory = {
        ...existing,
        ...(patch.title !== undefined && { title: patch.title }),
        ...(patch.content !== undefined && { content: patch.content }),
        ...(patch.kind !== undefined && { kind: patch.kind }),
        updated_at: mockNow(),
      };
      store.set(id, next);
      return next;
    }

    return json(
      await fetch(`${BASE}/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }),
    );
  },

  /** Archives rather than destroys, so a mistaken delete is recoverable in SQL. */
  remove: async (id: string): Promise<void> => {
    if (flags.mockMemory) {
      // Archiving and deleting look identical from here: both mean "stops
      // being returned by every read this client makes".
      if (!mockStore().memory.delete(id)) throw new Error("Memory not found.");
      return;
    }

    const res = await fetch(`${BASE}/${id}`, { method: "DELETE" });
    if (!res.ok) await json(res);
  },
};
