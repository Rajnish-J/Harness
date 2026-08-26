/**
 * Drizzle access for the three registries.
 *
 * Same shape as workflow-service.ts: lazy getDb(), `.returning()` on writes,
 * `row ?? null` on single-row reads. Unlike workflows there is no Python
 * /validate round-trip — nothing here is an executable graph, so the route
 * handlers validate the fields inline.
 */

import { desc, eq } from "drizzle-orm";

import { getDb } from "@/db";
import { agents, mcpServers, skills } from "@/db/schema";
import { flags } from "@/lib/flags";
import { toAgentRow, toMcpRow, toSkillRow } from "@/lib/mock/registry";
import {
  assertUnique,
  byUpdatedDesc,
  mockId,
  mockNow,
  mockStore,
} from "@/lib/mock/store";
import type {
  Agent,
  AgentInput,
  McpServer,
  McpServerInput,
  Skill,
  SkillInput,
} from "@/lib/registry-types";

/**
 * Drop undefined keys so a spread patch cannot blank a field the caller never
 * mentioned. The Drizzle path gets this for free from its per-key spreads.
 */
function prune<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

// ------------------------------------------------------------- MCP servers

export async function listMcpServers() {
  if (flags.mockMcp) {
    return byUpdatedDesc([...mockStore().mcp.values()]).map((server) => {
      const row = toMcpRow(server);
      return {
        id: row.id,
        name: row.name,
        description: row.description,
        transport: row.transport,
        command: row.command,
        url: row.url,
        enabled: row.enabled,
        updatedAt: row.updatedAt,
      };
    });
  }

  return getDb()
    .select({
      id: mcpServers.id,
      name: mcpServers.name,
      description: mcpServers.description,
      transport: mcpServers.transport,
      command: mcpServers.command,
      url: mcpServers.url,
      enabled: mcpServers.enabled,
      updatedAt: mcpServers.updatedAt,
    })
    .from(mcpServers)
    .orderBy(desc(mcpServers.updatedAt));
}

export async function getMcpServer(id: string) {
  if (flags.mockMcp) {
    const found = mockStore().mcp.get(id);
    return found ? toMcpRow(found) : null;
  }

  const [row] = await getDb()
    .select()
    .from(mcpServers)
    .where(eq(mcpServers.id, id))
    .limit(1);
  return row ?? null;
}

export async function createMcpServer(input: McpServerInput) {
  if (flags.mockMcp) {
    const store = mockStore().mcp;
    assertUnique(
      [...store.values()].some((server) => server.name === input.name),
      "mcp server name",
    );
    const now = mockNow();
    const created: McpServer = {
      id: mockId(),
      name: input.name,
      description: input.description ?? null,
      transport: input.transport,
      command: input.command ?? null,
      args: input.args ?? [],
      url: input.url ?? null,
      env: input.env ?? {},
      headers: input.headers ?? {},
      enabled: input.enabled ?? true,
      createdAt: now,
      updatedAt: now,
    };
    store.set(created.id, created);
    return toMcpRow(created);
  }

  const [row] = await getDb()
    .insert(mcpServers)
    .values({
      name: input.name,
      description: input.description ?? null,
      transport: input.transport,
      command: input.command ?? null,
      args: input.args ?? [],
      url: input.url ?? null,
      env: input.env ?? {},
      headers: input.headers ?? {},
      enabled: input.enabled ?? true,
    })
    .returning();
  return row;
}

export async function updateMcpServer(id: string, patch: Partial<McpServerInput>) {
  if (flags.mockMcp) {
    const store = mockStore().mcp;
    const existing = store.get(id);
    if (!existing) return null;
    if (patch.name !== undefined) {
      assertUnique(
        [...store.values()].some((row) => row.id !== id && row.name === patch.name),
        "mcp server name",
      );
    }
    const next: McpServer = { ...existing, ...prune(patch), updatedAt: mockNow() };
    store.set(id, next);
    return toMcpRow(next);
  }

  const [row] = await getDb()
    .update(mcpServers)
    .set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.transport !== undefined ? { transport: patch.transport } : {}),
      ...(patch.command !== undefined ? { command: patch.command } : {}),
      ...(patch.args !== undefined ? { args: patch.args } : {}),
      ...(patch.url !== undefined ? { url: patch.url } : {}),
      ...(patch.env !== undefined ? { env: patch.env } : {}),
      ...(patch.headers !== undefined ? { headers: patch.headers } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      updatedAt: new Date(),
    })
    .where(eq(mcpServers.id, id))
    .returning();
  return row ?? null;
}

export async function deleteMcpServer(id: string) {
  if (flags.mockMcp) {
    return mockStore().mcp.delete(id) ? { id } : null;
  }

  const [row] = await getDb()
    .delete(mcpServers)
    .where(eq(mcpServers.id, id))
    .returning({ id: mcpServers.id });
  return row ?? null;
}

// ------------------------------------------------------------------ Skills

export async function listSkills() {
  if (flags.mockSkills) {
    return byUpdatedDesc([...mockStore().skills.values()]).map((skill) => {
      const row = toSkillRow(skill);
      return {
        id: row.id,
        slug: row.slug,
        name: row.name,
        description: row.description,
        enabled: row.enabled,
        updatedAt: row.updatedAt,
      };
    });
  }

  return getDb()
    .select({
      id: skills.id,
      slug: skills.slug,
      name: skills.name,
      description: skills.description,
      enabled: skills.enabled,
      updatedAt: skills.updatedAt,
    })
    .from(skills)
    .orderBy(desc(skills.updatedAt));
}

export async function getSkill(id: string) {
  if (flags.mockSkills) {
    const found = mockStore().skills.get(id);
    return found ? toSkillRow(found) : null;
  }

  const [row] = await getDb().select().from(skills).where(eq(skills.id, id)).limit(1);
  return row ?? null;
}

export async function createSkill(input: SkillInput & { slug: string }) {
  if (flags.mockSkills) {
    const store = mockStore().skills;
    assertUnique(
      [...store.values()].some((skill) => skill.slug === input.slug),
      "skill slug",
    );
    const now = mockNow();
    const created: Skill = {
      id: mockId(),
      slug: input.slug,
      name: input.name,
      description: input.description ?? null,
      content: input.content ?? "",
      allowedTools: input.allowedTools ?? [],
      enabled: input.enabled ?? true,
      createdAt: now,
      updatedAt: now,
    };
    store.set(created.id, created);
    return toSkillRow(created);
  }

  const [row] = await getDb()
    .insert(skills)
    .values({
      slug: input.slug,
      name: input.name,
      description: input.description ?? null,
      content: input.content ?? "",
      allowedTools: input.allowedTools ?? [],
      enabled: input.enabled ?? true,
    })
    .returning();
  return row;
}

export async function updateSkill(id: string, patch: Partial<SkillInput>) {
  if (flags.mockSkills) {
    const store = mockStore().skills;
    const existing = store.get(id);
    if (!existing) return null;
    if (patch.slug !== undefined) {
      assertUnique(
        [...store.values()].some((row) => row.id !== id && row.slug === patch.slug),
        "skill slug",
      );
    }
    const next: Skill = { ...existing, ...prune(patch), updatedAt: mockNow() };
    store.set(id, next);
    return toSkillRow(next);
  }

  const [row] = await getDb()
    .update(skills)
    .set({
      ...(patch.slug !== undefined ? { slug: patch.slug } : {}),
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.content !== undefined ? { content: patch.content } : {}),
      ...(patch.allowedTools !== undefined ? { allowedTools: patch.allowedTools } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      updatedAt: new Date(),
    })
    .where(eq(skills.id, id))
    .returning();
  return row ?? null;
}

export async function deleteSkill(id: string) {
  if (flags.mockSkills) {
    return mockStore().skills.delete(id) ? { id } : null;
  }

  const [row] = await getDb()
    .delete(skills)
    .where(eq(skills.id, id))
    .returning({ id: skills.id });
  return row ?? null;
}

// ------------------------------------------------------------------ Agents

export async function listAgents() {
  if (flags.mockAgents) {
    return byUpdatedDesc([...mockStore().agents.values()]).map((agent) => {
      const row = toAgentRow(agent);
      return {
        id: row.id,
        slug: row.slug,
        name: row.name,
        description: row.description,
        model: row.model,
        enabled: row.enabled,
        updatedAt: row.updatedAt,
      };
    });
  }

  return getDb()
    .select({
      id: agents.id,
      slug: agents.slug,
      name: agents.name,
      description: agents.description,
      model: agents.model,
      enabled: agents.enabled,
      updatedAt: agents.updatedAt,
    })
    .from(agents)
    .orderBy(desc(agents.updatedAt));
}

export async function getAgent(id: string) {
  if (flags.mockAgents) {
    const found = mockStore().agents.get(id);
    return found ? toAgentRow(found) : null;
  }

  const [row] = await getDb().select().from(agents).where(eq(agents.id, id)).limit(1);
  return row ?? null;
}

export async function createAgent(input: AgentInput & { slug: string }) {
  if (flags.mockAgents) {
    const store = mockStore().agents;
    assertUnique(
      [...store.values()].some((agent) => agent.slug === input.slug),
      "agent slug",
    );
    const now = mockNow();
    const created: Agent = {
      id: mockId(),
      slug: input.slug,
      name: input.name,
      description: input.description ?? null,
      systemPrompt: input.systemPrompt ?? "",
      model: input.model ?? null,
      maxIterations: input.maxIterations ?? null,
      toolNames: input.toolNames ?? [],
      skillIds: input.skillIds ?? [],
      mcpServerIds: input.mcpServerIds ?? [],
      enabled: input.enabled ?? true,
      createdAt: now,
      updatedAt: now,
    };
    store.set(created.id, created);
    return toAgentRow(created);
  }

  const [row] = await getDb()
    .insert(agents)
    .values({
      slug: input.slug,
      name: input.name,
      description: input.description ?? null,
      systemPrompt: input.systemPrompt ?? "",
      model: input.model ?? null,
      maxIterations: input.maxIterations ?? null,
      toolNames: input.toolNames ?? [],
      skillIds: input.skillIds ?? [],
      mcpServerIds: input.mcpServerIds ?? [],
      enabled: input.enabled ?? true,
    })
    .returning();
  return row;
}

export async function updateAgent(id: string, patch: Partial<AgentInput>) {
  if (flags.mockAgents) {
    const store = mockStore().agents;
    const existing = store.get(id);
    if (!existing) return null;
    if (patch.slug !== undefined) {
      assertUnique(
        [...store.values()].some((row) => row.id !== id && row.slug === patch.slug),
        "agent slug",
      );
    }
    const next: Agent = { ...existing, ...prune(patch), updatedAt: mockNow() };
    store.set(id, next);
    return toAgentRow(next);
  }

  const [row] = await getDb()
    .update(agents)
    .set({
      ...(patch.slug !== undefined ? { slug: patch.slug } : {}),
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.systemPrompt !== undefined ? { systemPrompt: patch.systemPrompt } : {}),
      ...(patch.model !== undefined ? { model: patch.model } : {}),
      ...(patch.maxIterations !== undefined ? { maxIterations: patch.maxIterations } : {}),
      ...(patch.toolNames !== undefined ? { toolNames: patch.toolNames } : {}),
      ...(patch.skillIds !== undefined ? { skillIds: patch.skillIds } : {}),
      ...(patch.mcpServerIds !== undefined ? { mcpServerIds: patch.mcpServerIds } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      updatedAt: new Date(),
    })
    .where(eq(agents.id, id))
    .returning();
  return row ?? null;
}

export async function deleteAgent(id: string) {
  if (flags.mockAgents) {
    return mockStore().agents.delete(id) ? { id } : null;
  }

  const [row] = await getDb()
    .delete(agents)
    .where(eq(agents.id, id))
    .returning({ id: agents.id });
  return row ?? null;
}
