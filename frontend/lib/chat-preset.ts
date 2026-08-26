/**
 * What the chat composer has attached, and how it reaches the wire.
 *
 * The backend takes resolved text for the agent prompt and skill bodies, but
 * only opaque ids for MCP servers — those rows hold plaintext credentials, so
 * they stay server-side. See backend/app/models/chat.py for the full reasoning.
 */

import type { Agent, McpServerSummary, Skill } from "./registry-types";

export type AgentAttachment = Pick<
  Agent,
  "id" | "slug" | "name" | "systemPrompt" | "model" | "maxIterations"
>;

export type SkillAttachment = Pick<
  Skill,
  "id" | "slug" | "name" | "description" | "content"
>;

export type McpAttachment = Pick<McpServerSummary, "id" | "name">;

export type ChatPreset = {
  agent: AgentAttachment | null;
  skills: SkillAttachment[];
  /** null means "inherit": the full registry, or whatever the agent allows. */
  toolNames: string[] | null;
  mcpServers: McpAttachment[];
};

export const EMPTY_PRESET: ChatPreset = {
  agent: null,
  skills: [],
  toolNames: null,
  mcpServers: [],
};

export function isPresetEmpty(preset: ChatPreset): boolean {
  return (
    preset.agent === null &&
    preset.skills.length === 0 &&
    preset.mcpServers.length === 0 &&
    (preset.toolNames === null || preset.toolNames.length === 0)
  );
}

/**
 * Map the preset onto the snake_case wire body.
 *
 * Empty fields are omitted rather than sent as nulls, so a chat with nothing
 * attached posts byte-for-byte what it posted before presets existed. That is
 * what makes "no regression for the default path" a checkable claim rather than
 * a hopeful one.
 */
export function presetToBody(
  preset: ChatPreset | undefined,
  base: { session_id: string; message: string },
): Record<string, unknown> {
  const body: Record<string, unknown> = { ...base };
  if (!preset) return body;

  if (preset.agent) {
    body.agent_id = preset.agent.id;
    body.agent_name = preset.agent.name;
    if (preset.agent.systemPrompt) body.system_prompt = preset.agent.systemPrompt;
    if (preset.agent.model) body.model = preset.agent.model;
    if (preset.agent.maxIterations) body.max_iterations = preset.agent.maxIterations;
  }

  if (preset.skills.length > 0) {
    body.skills = preset.skills.map((skill) => ({
      name: skill.name,
      slug: skill.slug,
      description: skill.description,
      content: skill.content,
    }));
  }

  if (preset.toolNames && preset.toolNames.length > 0) {
    body.tool_names = preset.toolNames;
  }

  if (preset.mcpServers.length > 0) {
    body.mcp_server_ids = preset.mcpServers.map((server) => server.id);
  }

  return body;
}

/** A one-line summary for the switcher, e.g. "claude-opus-5 · 3 tools · 2 skills". */
export function describePreset(preset: ChatPreset): string {
  const parts: string[] = [];
  if (preset.agent?.model) parts.push(preset.agent.model);
  if (preset.toolNames?.length) {
    parts.push(`${preset.toolNames.length} tool${preset.toolNames.length === 1 ? "" : "s"}`);
  }
  if (preset.skills.length) {
    parts.push(`${preset.skills.length} skill${preset.skills.length === 1 ? "" : "s"}`);
  }
  if (preset.mcpServers.length) {
    parts.push(`${preset.mcpServers.length} MCP`);
  }
  return parts.join(" · ");
}
