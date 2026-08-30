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
import type {
  CloneEvent,
  ConnectGithubInput,
  ContainerState,
  FileContent,
  GitStatus,
  Project,
  ProjectInput,
  ProjectPatch,
  PullRequest,
  PurgeResult,
  RemoteRepo,
  StoredMessage,
  TreeLevel,
} from "./project-types";
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

  update: async (id: string, patch: ProjectPatch): Promise<Project> =>
    json(
      await fetch(`${BASE}/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }),
    ),

  /** Soft delete — the row is archived, not destroyed. Pair with `purge`. */
  remove: async (id: string): Promise<void> => {
    const res = await fetch(`${BASE}/${id}`, { method: "DELETE" });
    if (!res.ok) await json(res);
  },

  /**
   * Reclaim what archiving leaves behind: the container, the file index, and
   * the checkout on disk.
   *
   * Separate from `remove` because the two halves of a project live on two
   * servers — Next.js owns the row, Python owns the disk — and only one of them
   * can be undone. Call it *after* `remove`: the row going away is the outcome
   * the operator asked for, and a purge that fails (no daemon, a locked file)
   * should degrade to "the files are still there" rather than stranding a
   * gutted project in the list.
   *
   * POST, not DELETE: the harness runs CORS with `allow_methods=["GET","POST"]`.
   */
  purge: async (id: string): Promise<PurgeResult> =>
    json(
      await fetch(`${API_BASE}/api/projects/${id}/purge`, { method: "POST" }),
    ),

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

  /**
   * Set up a Blank Project's working tree: `git init`, a README, one commit.
   *
   * Unlike `clone`, this never touches the network, so it answers once rather
   * than streaming.
   */
  init: async (id: string): Promise<{ branch: string | null; file_count: number }> =>
    json(
      await fetch(`${API_BASE}/api/projects/${id}/init`, { method: "POST" }),
    ),

  /**
   * Link a Blank Project to a GitHub remote it hasn't been connected to yet.
   *
   * Two steps against two servers, same as create+clone: this call persists
   * the remote's coordinates (Next.js owns that), then `pushToRemote` actually
   * pushes to it (only Python's side has a decrypted token and a working tree).
   */
  connect: async (id: string, input: ConnectGithubInput): Promise<Project> =>
    json(
      await fetch(`${BASE}/${id}/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
    ),

  /** Point the working tree at the remote just linked with `connect`, and push. */
  pushToRemote: async (id: string): Promise<{ branch: string | null }> =>
    json(
      await fetch(`${API_BASE}/api/projects/${id}/connect`, { method: "POST" }),
    ),
};

/**
 * Container lifecycle.
 *
 * Straight to the Python harness rather than through a Next.js route: only that
 * side talks to the Docker daemon, and proxying would add a hop that could only
 * relay the answer verbatim.
 */
export const containerApi = {
  status: async (projectId: string, signal?: AbortSignal): Promise<ContainerState> =>
    json(
      await fetch(`${API_BASE}/api/projects/${projectId}/container`, {
        cache: "no-store",
        signal,
      }),
    ),

  start: async (projectId: string): Promise<ContainerState> =>
    json(
      await fetch(`${API_BASE}/api/projects/${projectId}/container/start`, {
        method: "POST",
      }),
    ),

  stop: async (projectId: string): Promise<ContainerState> =>
    json(
      await fetch(`${API_BASE}/api/projects/${projectId}/container/stop`, {
        method: "POST",
      }),
    ),

  remove: async (projectId: string): Promise<ContainerState> =>
    json(
      await fetch(`${API_BASE}/api/projects/${projectId}/container/remove`, {
        method: "POST",
      }),
    ),
};

/** Files and git for one project. Straight to the harness, like the container API. */
export const projectFilesApi = {
  tree: async (projectId: string, dirPath = ""): Promise<TreeLevel> =>
    json(
      await fetch(
        `${API_BASE}/api/projects/${projectId}/tree?dir_path=${encodeURIComponent(dirPath)}`,
        { cache: "no-store" },
      ),
    ),

  read: async (projectId: string, path: string): Promise<FileContent> =>
    json(
      await fetch(
        `${API_BASE}/api/projects/${projectId}/file?path=${encodeURIComponent(path)}`,
        { cache: "no-store" },
      ),
    ),

  write: async (
    projectId: string,
    path: string,
    content: string,
  ): Promise<FileContent> =>
    json(
      await fetch(`${API_BASE}/api/projects/${projectId}/file`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, content }),
      }),
    ),

  history: async (projectId: string): Promise<{ messages: StoredMessage[] }> =>
    json(
      await fetch(`${API_BASE}/api/projects/${projectId}/chat/history`, {
        cache: "no-store",
      }),
    ),
};

export const projectGitApi = {
  status: async (projectId: string): Promise<GitStatus> =>
    json(
      await fetch(`${API_BASE}/api/projects/${projectId}/git`, { cache: "no-store" }),
    ),

  createBranch: async (
    projectId: string,
    name: string,
    base?: string,
  ): Promise<GitStatus> =>
    json(
      await fetch(`${API_BASE}/api/projects/${projectId}/branches`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, base }),
      }),
    ),

  commit: async (
    projectId: string,
    message: string,
    pushAfter = true,
  ): Promise<{ committed: boolean; pushed: boolean; branch: string | null }> =>
    json(
      await fetch(`${API_BASE}/api/projects/${projectId}/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, push_after: pushAfter }),
      }),
    ),

  pull: async (
    projectId: string,
  ): Promise<{ branch: string | null; output: string }> =>
    json(
      await fetch(`${API_BASE}/api/projects/${projectId}/pull`, {
        method: "POST",
      }),
    ),

  listPulls: async (projectId: string): Promise<{ pulls: PullRequest[] }> =>
    json(
      await fetch(`${API_BASE}/api/projects/${projectId}/pulls`, {
        cache: "no-store",
      }),
    ),

  createPull: async (
    projectId: string,
    input: { title: string; body?: string; base?: string; draft?: boolean },
  ): Promise<PullRequest> =>
    json(
      await fetch(`${API_BASE}/api/projects/${projectId}/pulls`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
    ),

  mergePull: async (
    projectId: string,
    number: number,
    method = "merge",
  ): Promise<{ merged: boolean; sha: string }> =>
    json(
      await fetch(`${API_BASE}/api/projects/${projectId}/pulls/${number}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method }),
      }),
    ),
};
