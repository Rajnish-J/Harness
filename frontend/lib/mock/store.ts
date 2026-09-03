/**
 * A mutable in-memory stand-in for the registry tables.
 *
 * Without this, mock mode would be read-only and the whole create/edit/delete
 * loop — the part most worth exercising with no database — would be untestable.
 *
 * Cached on globalThis for the same reason db/index.ts caches its pool: Next's
 * dev HMR re-evaluates modules on every reload, and a plain module-level Map
 * would reset mid-session and lose whatever you just created.
 *
 * Scope, stated plainly: this lives in one server process and resets when that
 * process restarts. It is a development fixture, not persistence.
 */

import type { Memory } from "@/lib/memory-api";
import type { Agent, McpServer, Skill } from "@/lib/registry-types";
import { MOCK_MEMORIES } from "./memory";
import { MOCK_AGENTS, MOCK_MCP_SERVERS, MOCK_SKILLS } from "./registry";

type Stores = {
  agents: Map<string, Agent>;
  skills: Map<string, Skill>;
  mcp: Map<string, McpServer>;
  /** Unlike the three above, this one is written from the BROWSER — memory is
   *  fetched client-side from the Python harness rather than through a Next
   *  route — so it lives in the tab's realm and resets on a full reload. */
  memory: Map<string, Memory>;
};

const globalForMock = globalThis as unknown as { __harnessMock?: Stores };

function seed(): Stores {
  return {
    // Structured-cloned so mutating a stored record can never write through to
    // the frozen-by-convention fixture arrays.
    agents: new Map(MOCK_AGENTS.map((a) => [a.id, { ...a }])),
    skills: new Map(MOCK_SKILLS.map((s) => [s.id, { ...s }])),
    mcp: new Map(MOCK_MCP_SERVERS.map((m) => [m.id, { ...m }])),
    memory: new Map(MOCK_MEMORIES.map((m) => [m.id, { ...m }])),
  };
}

export function mockStore(): Stores {
  if (!globalForMock.__harnessMock) globalForMock.__harnessMock = seed();
  return globalForMock.__harnessMock;
}

/**
 * Minted inside a create call — an event-driven code path, never a render — so
 * this is safe despite the module-scope rule in registry.ts.
 */
export function mockId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `mock-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function mockNow(): string {
  return new Date().toISOString();
}

/** Newest first, matching the real services' `orderBy(desc(updatedAt))`. */
export function byUpdatedDesc<T extends { updatedAt: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * The real services surface a unique-constraint violation as a 409. The mock
 * store has no constraints, so it raises the same shape the route handlers
 * already know how to classify.
 */
export class MockUniqueViolation extends Error {
  code = "23505";
}

export function assertUnique(
  taken: boolean,
  what: string,
): void {
  if (taken) throw new MockUniqueViolation(`duplicate ${what}`);
}
