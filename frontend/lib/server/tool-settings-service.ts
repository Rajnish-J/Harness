/**
 * Drizzle access for the global tool disable list behind /tools.
 *
 * Same shape as registry-service.ts: lazy getDb(), a flags.mockTools short
 * circuit at the top of each function, `.returning()` on writes.
 *
 * Why this is served from Next and not from Python's GET /api/workflows/tools,
 * which the same page already calls: that endpoint answers with `ToolInfo`,
 * which is shared with the workflow node palette, where a chat-side global has
 * no defined meaning — shipping a `disabled` flag there would invite someone to
 * honour it in a place nobody decided it applies. It is also pool-free today,
 * and giving it a database dependency to save one same-origin fetch is a poor
 * trade. Read and write stay on the side that owns the table.
 *
 * The list is a SUBTRACTION, never an allowlist. Nothing here narrows a turn on
 * its own; backend/app/api/chat.py removes these names after resolving whatever
 * the composer or the agent asked for.
 */

import { eq } from "drizzle-orm";

import { getDb } from "@/db";
import { toolSettings } from "@/db/schema";
import { flags } from "@/lib/flags";
import { mockStore } from "@/lib/mock/store";

/**
 * A ceiling on one request, not on the table.
 *
 * Mirrors the max_length=200 on ChatRequest.tool_names: a group toggle sends
 * one name per tool in the group, and no group is remotely near this.
 */
export const MAX_TOOL_NAMES = 500;

/** Long enough for `mcp__{server}__{tool}` after Anthropic's 128-char clamp. */
export const MAX_TOOL_NAME_LENGTH = 200;

export class ToolNameError extends Error {}

/**
 * Names are validated but never checked against a registry.
 *
 * The tool registry lives in Python, and this table is written by a browser
 * that may know about tools this process cannot enumerate — MCP tools in
 * particular exist only after a live connection. An unknown name is stored and
 * is simply inert: it matches no tool, so it grants and revokes nothing.
 */
function assertNames(names: string[]): void {
  if (names.length > MAX_TOOL_NAMES) {
    throw new ToolNameError(
      `Too many tools in one request — ${names.length}, and the limit is ${MAX_TOOL_NAMES}.`,
    );
  }
  for (const name of names) {
    if (name.trim() === "") {
      throw new ToolNameError("A tool name cannot be blank.");
    }
    if (name.length > MAX_TOOL_NAME_LENGTH) {
      throw new ToolNameError(
        `"${name.slice(0, 40)}…" is too long for a tool name.`,
      );
    }
  }
}

/** Every tool switched off globally. Sorted, so the response body is stable. */
export async function listDisabledTools(): Promise<string[]> {
  if (flags.mockTools) {
    return [...mockStore().disabledTools].sort();
  }

  const db = getDb();
  const rows = await db
    .select({ toolName: toolSettings.toolName })
    .from(toolSettings)
    .where(eq(toolSettings.enabled, false));

  return rows.map((row) => row.toolName).sort();
}

/**
 * Switch a set of tools on or off, and report the resulting disable list.
 *
 * One statement, so a group toggle is atomic: the unique constraint on
 * tool_name turns it into an upsert, which is what keeps two tabs toggling at
 * once from clobbering each other. A jsonb array would have been
 * read-modify-write, and would lose a toggle.
 *
 * Re-enabling keeps the row rather than deleting it. Deleting would lose
 * updatedAt and make the mock and live paths differ in row count for no gain.
 *
 * Returns the whole list rather than an acknowledgement so the caller can
 * reconcile its optimistic state against the server's, instead of guessing.
 */
export async function setToolsEnabled(
  names: string[],
  enabled: boolean,
): Promise<string[]> {
  assertNames(names);
  if (names.length === 0) return listDisabledTools();

  if (flags.mockTools) {
    const store = mockStore().disabledTools;
    for (const name of names) {
      if (enabled) store.delete(name);
      else store.add(name);
    }
    return listDisabledTools();
  }

  const db = getDb();
  const now = new Date();

  await db
    .insert(toolSettings)
    // Deduplicated: ON CONFLICT cannot touch the same row twice in one
    // statement, and Postgres raises 21000 rather than silently taking the last
    // write. A group toggle can repeat a name when a tool is in two groups.
    .values(
      [...new Set(names)].map((toolName) => ({
        toolName,
        enabled,
        updatedAt: now,
      })),
    )
    .onConflictDoUpdate({
      target: toolSettings.toolName,
      set: { enabled, updatedAt: now },
    });

  return listDisabledTools();
}
