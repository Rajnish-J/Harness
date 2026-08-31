/**
 * Browser client for the project environment variable routes.
 *
 * Same shape as lib/credential-api.ts — same-origin route handlers, one `json`
 * unwrapper that turns an `{ error }` body into a thrown Error so callers can
 * `try/catch` and toast the message the server actually wrote.
 */

import type { EnvVarInput, EnvVarListRow, ProjectEnvVar } from "./env-var-types";

const BASE = "/api/project-env-vars";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as { error?: string }).error ?? `Request failed: ${res.status}`,
    );
  }
  return res.json() as Promise<T>;
}

export const envVarsApi = {
  list: async (): Promise<EnvVarListRow[]> =>
    json(await fetch(BASE, { cache: "no-store" })),

  create: async (input: EnvVarInput): Promise<ProjectEnvVar> =>
    json(
      await fetch(BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
    ),

  update: async (
    id: string,
    patch: Partial<Omit<EnvVarInput, "projectId">>,
  ): Promise<ProjectEnvVar> =>
    json(
      await fetch(`${BASE}/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }),
    ),

  remove: async (id: string): Promise<void> => {
    const res = await fetch(`${BASE}/${id}`, { method: "DELETE" });
    if (!res.ok) await json(res);
  },

  /** Paste a `.env`. Existing keys are overwritten, not rejected. */
  import: async (input: {
    projectId: string;
    dotenv: string;
    secret?: boolean;
  }): Promise<{ imported: number; rows: ProjectEnvVar[] }> =>
    json(
      await fetch(`${BASE}/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
    ),
};
