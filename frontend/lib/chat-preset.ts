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

/**
 * How the turn treats tools. Mirrors ToolMode in backend/app/models/chat.py.
 *
 * "orchestrator" is deliberately absent: that mode is the workflow canvas, so
 * the composer links to /workflows rather than pretending to run a pipeline.
 */
export type ToolMode = "agent" | "manual" | "chat";

export type ChatPreset = {
  agent: AgentAttachment | null;
  skills: SkillAttachment[];
  /** null means "inherit": the full registry, or whatever the agent allows. */
  toolNames: string[] | null;
  mcpServers: McpAttachment[];
  mode: ToolMode;
  /** An explicit pick in the composer. null means the agent's, then the server's. */
  model: string | null;
};

export const EMPTY_PRESET: ChatPreset = {
  agent: null,
  skills: [],
  toolNames: null,
  mcpServers: [],
  mode: "agent",
  model: null,
};

/**
 * True when nothing is *attached*. Mode and model are settings with their own
 * always-visible controls, not chips, so they are deliberately not counted —
 * otherwise picking a model would light up the "clear attachments" row.
 */
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
  base: Record<string, unknown> & { session_id: string },
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

  // After the agent block, so an explicit pick in the composer wins over the
  // agent's saved model rather than the other way round.
  if (preset.model) body.model = preset.model;
  if (preset.mode !== "agent") body.mode = preset.mode;

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
