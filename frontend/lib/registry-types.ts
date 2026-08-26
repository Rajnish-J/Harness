/**
 * DTOs for the MCP / skill / agent registries.
 *
 * Dates cross the wire as ISO strings, so these are not the Drizzle row types
 * (`McpServerRow` and friends) — those keep `Date`. Same split as
 * lib/workflow-types.ts.
 */

export type McpTransport = "stdio" | "sse" | "http";

export const MCP_TRANSPORTS: McpTransport[] = ["stdio", "sse", "http"];

/** What the list endpoint returns: no secrets, no argv. */
export type McpServerSummary = {
  id: string;
  name: string;
  description: string | null;
  transport: McpTransport;
  command: string | null;
  url: string | null;
  enabled: boolean;
  updatedAt: string;
};

export type McpServer = McpServerSummary & {
  args: string[];
  env: Record<string, string>;
  headers: Record<string, string>;
  createdAt: string;
};

export type McpServerInput = {
  name: string;
  description?: string | null;
  transport: McpTransport;
  command?: string | null;
  args?: string[];
  url?: string | null;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  enabled?: boolean;
};

export type SkillSummary = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  enabled: boolean;
  updatedAt: string;
};

export type Skill = SkillSummary & {
  content: string;
  allowedTools: string[];
  createdAt: string;
};

export type SkillInput = {
  slug?: string;
  name: string;
  description?: string | null;
  content?: string;
  allowedTools?: string[];
  enabled?: boolean;
};

export type AgentSummary = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  model: string | null;
  enabled: boolean;
  updatedAt: string;
};

export type Agent = AgentSummary & {
  systemPrompt: string;
  maxIterations: number | null;
  toolNames: string[];
  skillIds: string[];
  mcpServerIds: string[];
  createdAt: string;
};

export type AgentInput = {
  slug?: string;
  name: string;
  description?: string | null;
  systemPrompt?: string;
  model?: string | null;
  maxIterations?: number | null;
  toolNames?: string[];
  skillIds?: string[];
  mcpServerIds?: string[];
  enabled?: boolean;
};

/**
 * Slugs are derived from the display name so the operator never has to type
 * one. Collisions surface as a 409 from the unique constraint rather than
 * being silently de-duplicated.
 */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/** The placeholder the list endpoint substitutes for secret values. */
export const REDACTED = "••••••";
