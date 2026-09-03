/**
 * Fixtures for the memory surface — /memory and /memory-insights.
 *
 * Same two hard rules as registry.ts, and for the same reasons:
 *
 * 1. NO `@/db` or `@/lib/server/*` imports. This module is reachable from the
 *    client bundle — memory is fetched in the browser from the Python harness,
 *    not through a Next route — so dragging Drizzle in would put `pg` in the
 *    browser build.
 * 2. Ids and timestamps are LITERAL strings. `crypto.randomUUID()` or
 *    `new Date().toISOString()` at module scope evaluate separately on the
 *    server and in the browser, and /memory renders updated-at ordered rows,
 *    so either would hydration-mismatch.
 *
 * The set is chosen to exercise every branch the two pages have: both tiers
 * (global and project-scoped), both sources (agent and human), all four kinds,
 * memories from more than one session, and — deliberately — one memory whose
 * originating session no longer exists, which is a real state because
 * `clear_session` hard-deletes chat rows while the memory keeps the id.
 */

import type { Memory, MemoryOverview, MemoryPreview } from "@/lib/memory-api";

/** Shared timestamp table, so ordering between fixtures is intentional. */
const T = {
  oldest: "2026-08-14T09:12:00.000Z",
  old: "2026-08-19T15:40:00.000Z",
  mid: "2026-08-25T11:05:00.000Z",
  recent: "2026-08-29T16:22:00.000Z",
  newest: "2026-09-01T08:47:00.000Z",
} as const;

export const MOCK_MEMORY_PROJECT_IDS = {
  harnessWeb: "b7c1e4a2-1f3d-4c8e-9a55-2d6f0b8e1c34",
  taskTracker: "e2a9d5f1-7b40-4e21-8c93-5f1a3c7d9b02",
} as const;

/**
 * The projects the fixtures reference.
 *
 * Needed because `projectsApi.list()` has no mock branch of its own — projects
 * always hit Postgres — so with nothing running, the insights page would have
 * memories to group and no names to group them under.
 */
export const MOCK_MEMORY_PROJECTS: { id: string; name: string }[] = [
  { id: MOCK_MEMORY_PROJECT_IDS.harnessWeb, name: "harness-web" },
  { id: MOCK_MEMORY_PROJECT_IDS.taskTracker, name: "task-tracker" },
];

const SESSION_AUTH = "sess-8f21c4b0-auth-module";
const SESSION_CLONE = "sess-3d90ae77-clone-flow";
/** Referenced by a memory below, deliberately absent from MOCK_MEMORY_SESSIONS. */
const SESSION_GONE = "sess-0000dead-deleted-chat";

export const MOCK_MEMORIES: Memory[] = [
  {
    id: "1a2b3c4d-0001-4f00-9c01-aaaaaaaaaaa1",
    project_id: null,
    kind: "preference",
    slug: "prefers-tabs-over-spaces",
    title: "Prefers tabs over spaces",
    content:
      "Use tabs for indentation in new files. Why: stated during setup, and the " +
      "existing editor config assumes it. How to apply: match the file you are " +
      "editing when it disagrees.",
    source: "agent",
    session_id: SESSION_AUTH,
    created_at: T.oldest,
    updated_at: T.mid,
  },
  {
    id: "1a2b3c4d-0002-4f00-9c02-aaaaaaaaaaa2",
    project_id: null,
    kind: "feedback",
    slug: "run-tests-before-committing",
    title: "Run tests before committing",
    content:
      "Always run the test suite before a commit. Why: a broken build was merged " +
      "once and cost an afternoon. How to apply: run the project's own test " +
      "command, not just the file you touched.",
    source: "human",
    session_id: null,
    created_at: T.old,
    updated_at: T.old,
  },
  {
    id: "1a2b3c4d-0003-4f00-9c03-aaaaaaaaaaa3",
    project_id: null,
    kind: "reference",
    slug: "design-docs-live-in-notion",
    title: "Design docs live in Notion",
    content:
      "Architecture decisions are written up in Notion, not in the repo. Ask for " +
      "a link rather than guessing from the code when intent is unclear.",
    source: "human",
    session_id: null,
    created_at: T.old,
    updated_at: T.recent,
  },
  {
    id: "1a2b3c4d-0004-4f00-9c04-aaaaaaaaaaa4",
    project_id: MOCK_MEMORY_PROJECT_IDS.harnessWeb,
    kind: "fact",
    slug: "deploys-from-master",
    title: "This repo deploys from master",
    content:
      "The default branch is `master`, not `main` — CI deploys from it directly, " +
      "so a branch opened against `main` will never ship.",
    source: "agent",
    session_id: SESSION_CLONE,
    created_at: T.mid,
    updated_at: T.mid,
  },
  {
    id: "1a2b3c4d-0005-4f00-9c05-aaaaaaaaaaa5",
    project_id: MOCK_MEMORY_PROJECT_IDS.harnessWeb,
    kind: "feedback",
    slug: "no-new-dependencies",
    title: "Prefer the standard library here",
    content:
      "Do not add dependencies to this repo without asking. Why: it is a learning " +
      "project and the point is to build the pieces. How to apply: propose the " +
      "dependency and the alternative, then wait.",
    source: "agent",
    session_id: SESSION_AUTH,
    created_at: T.recent,
    updated_at: T.newest,
  },
  {
    id: "1a2b3c4d-0006-4f00-9c06-aaaaaaaaaaa6",
    project_id: MOCK_MEMORY_PROJECT_IDS.taskTracker,
    kind: "fact",
    slug: "auth-lives-in-services-auth",
    title: "JWT validation lives in services/auth.py",
    content:
      "Token validation moved out of the middleware into `services/auth.py`. " +
      "Anything touching auth starts there, not in the request pipeline.",
    source: "agent",
    session_id: SESSION_GONE,
    created_at: T.oldest,
    updated_at: T.oldest,
  },
];

export const MOCK_MEMORY_SESSIONS: MemoryOverview["sessions"] = [
  {
    session_id: SESSION_AUTH,
    title: "add the auth module and wire it into the router",
    updated_at: T.newest,
    message_count: 24,
  },
  {
    session_id: SESSION_CLONE,
    title: "why does the clone step hang on a big repo?",
    updated_at: T.mid,
    message_count: 11,
  },
];

/** Newest first. `byUpdatedDesc` in store.ts keys on camelCase `updatedAt`;
 *  memory's DTO is snake_case because it comes from Python, not Drizzle. */
export function byUpdatedAtDesc(rows: Memory[]): Memory[] {
  return [...rows].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

/** Scope exactly as the backend does: global rows always, plus one project's. */
export function inScope(rows: Memory[], projectId?: string | null): Memory[] {
  return rows.filter(
    (row) => row.project_id === null || (!!projectId && row.project_id === projectId),
  );
}

/**
 * Render the `<memories>` block the way app/agent/prompt.py does — sorted by
 * (kind, slug), one tagged block each. Kept in step with `_memory_block` by
 * hand; a drift here only misleads in mock mode, where the real composer is
 * unreachable by definition.
 */
export function renderMemoryBlock(rows: Memory[]): string {
  const usable = rows.filter((row) => row.content.trim());
  if (usable.length === 0) return "";

  const ordered = [...usable].sort(
    (a, b) => a.kind.localeCompare(b.kind) || a.slug.localeCompare(b.slug),
  );
  const blocks = ordered
    .map((row) =>
      [
        `<memory kind="${row.kind}" slug="${row.slug}">`,
        `<title>${row.title}</title>`,
        row.content,
        "</memory>",
      ].join("\n"),
    )
    .join("\n");
  return `<memories>\n${blocks}\n</memories>`;
}

export function mockPreview(rows: Memory[], projectId?: string | null): MemoryPreview {
  const scoped = inScope(rows, projectId);
  const block = renderMemoryBlock(scoped);
  return {
    project_id: projectId ?? null,
    block,
    char_count: block.length,
    memory_count: scoped.length,
    // Matches Settings.max_system_prompt_chars in backend/app/core/config.py.
    max_system_prompt_chars: 120_000,
  };
}
