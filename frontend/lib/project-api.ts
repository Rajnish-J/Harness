/**
 * Browser client for projects.
 *
 * Split across two origins, which is why this is not built on registry-api's
 * `crud()` helper:
 *
 * - CRUD is same-origin Next.js route handlers, backed by Drizzle.
 * - Repo discovery and cloning go straight to the Python harness at API_BASE,
 *   because both need a decrypted token and that path lives on one side only.
 */

import { API_BASE } from "./api";
import type { CloneEvent, Project, ProjectInput, RemoteRepo } from "./project-types";
import { consumeSSE } from "./sse";

const BASE = "/api/projects";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as { error?: string; detail?: string }).error ??
        (body as { detail?: string }).detail ??
        `Request failed: ${res.status}`,
    );
  }
  return res.json() as Promise<T>;
}

export const projectsApi = {
  list: async (): Promise<Project[]> => json(await fetch(BASE, { cache: "no-store" })),

  get: async (id: string): Promise<Project> =>
    json(await fetch(`${BASE}/${id}`, { cache: "no-store" })),

  create: async (input: ProjectInput): Promise<Project> =>
    json(
      await fetch(BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
    ),

  update: async (id: string, patch: Partial<ProjectInput>): Promise<Project> =>
    json(
      await fetch(`${BASE}/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }),
    ),

  /** Soft delete — the row is archived, not destroyed. */
  remove: async (id: string): Promise<void> => {
    const res = await fetch(`${BASE}/${id}`, { method: "DELETE" });
    if (!res.ok) await json(res);
  },

  /** Repositories a stored credential can see. Paged, not exhaustive. */
  listRemoteRepos: async (
    credentialId: string,
    options: { page?: number; search?: string; signal?: AbortSignal } = {},
  ): Promise<RemoteRepo[]> => {
    const params = new URLSearchParams({
      credential_id: credentialId,
      page: String(options.page ?? 1),
    });
    if (options.search) params.set("search", options.search);

    const res = await fetch(`${API_BASE}/api/projects/github/repos?${params}`, {
      signal: options.signal,
    });
    const body = await json<{ repos: RemoteRepo[] }>(res);
    return body.repos;
  },

  /**
   * Clone a project, streaming progress.
   *
   * Reuses consumeSSE, the same hand-rolled frame parser chat and workflow runs
   * use — the browser's EventSource is GET-only and this is a POST.
   */
  clone: async (
    id: string,
    onEvent: (event: CloneEvent) => void,
    signal?: AbortSignal,
  ): Promise<void> => {
    const res = await fetch(`${API_BASE}/api/projects/${id}/clone`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
    });
    if (!res.ok) await json(res);
    await consumeSSE<CloneEvent>(res, onEvent);
  },
};
