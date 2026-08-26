/**
 * Browser client for the registry CRUD routes.
 *
 * All of these are Next.js route handlers backed by Drizzle, so they are
 * same-origin relative paths — unlike lib/api.ts, which talks to the Python
 * harness at API_BASE. Same split as lib/workflow-api.ts.
 */

import type {
  Agent,
  AgentInput,
  AgentSummary,
  McpServer,
  McpServerInput,
  McpServerSummary,
  Skill,
  SkillInput,
  SkillSummary,
} from "./registry-types";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as { error?: string }).error ?? `Request failed: ${res.status}`,
    );
  }
  return res.json() as Promise<T>;
}

function crud<Summary, Full, Input>(base: string) {
  return {
    list: async (): Promise<Summary[]> =>
      json(await fetch(base, { cache: "no-store" })),
    get: async (id: string): Promise<Full> =>
      json(await fetch(`${base}/${id}`, { cache: "no-store" })),
    create: async (input: Input): Promise<Full> =>
      json(
        await fetch(base, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        }),
      ),
    update: async (id: string, patch: Partial<Input>): Promise<Full> =>
      json(
        await fetch(`${base}/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        }),
      ),
    remove: async (id: string): Promise<void> => {
      const res = await fetch(`${base}/${id}`, { method: "DELETE" });
      if (!res.ok) await json(res);
    },
  };
}

export const mcpApi = crud<McpServerSummary, McpServer, McpServerInput>("/api/mcp");
export const skillsApi = crud<SkillSummary, Skill, SkillInput>("/api/skills");
export const agentsApi = crud<AgentSummary, Agent, AgentInput>("/api/agents");
