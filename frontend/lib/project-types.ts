/**
 * DTOs for projects.
 *
 * Same split as lib/registry-types.ts and lib/credential-types.ts: dates cross
 * the wire as ISO strings, so these are not the Drizzle row types.
 */

import type { CredentialProvider } from "./credential-types";

export type CloneStatus = "pending" | "cloning" | "ready" | "error";

/**
 * How a project came to exist. Provenance, not current connection state — a
 * `blank` project can be linked to a GitHub remote later (see `repoUrl`)
 * without turning into a `github` row.
 */
export type ProjectKind = "blank" | "github";

export type Project = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  kind: ProjectKind;
  provider: CredentialProvider;
  /** Null for a Blank Project until it is connected to a remote. */
  repoOwner: string | null;
  repoName: string | null;
  repoUrl: string | null;
  repoId: string | null;
  defaultBranch: string;
  visibility: string;
  credentialId: string | null;
  cloneStatus: CloneStatus;
  cloneError: string | null;
  currentBranch: string | null;
  lastPulledAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Creates a project by cloning an existing GitHub repository. */
export type GithubProjectInput = {
  kind?: "github";
  name?: string;
  slug?: string;
  provider?: CredentialProvider;
  repoOwner: string;
  repoName: string;
  repoUrl: string;
  repoId?: string | null;
  defaultBranch?: string;
  visibility?: string;
  credentialId?: string | null;
};

/** Creates a project with no remote — just a name and an empty working tree. */
export type BlankProjectInput = {
  kind: "blank";
  name: string;
  description?: string | null;
  slug?: string;
};

export type ProjectInput = GithubProjectInput | BlankProjectInput;

/**
 * The only fields PATCH /api/projects/{id} accepts.
 *
 * Narrower than `Partial<ProjectInput>`, which is a Partial of a *union* and so
 * happily type-checks `repoUrl` or `kind` — neither of which the route will
 * apply. The repo coordinates describe what was cloned and `cloneStatus` is
 * Python's to write, so widening this means the row can disagree with the
 * checkout on disk.
 */
export type ProjectPatch = {
  name?: string;
  credentialId?: string | null;
  defaultBranch?: string;
};

/** What POST /api/projects/{id}/purge reports after reclaiming a project. */
export type PurgeResult = {
  workspace_removed: boolean;
  container_removed: boolean;
  message: string;
};

/**
 * A project as the list page renders it.
 *
 * The file count is not a column on `projects` — it is one grouped query over
 * `project_files` (`fileCountsByProject`), joined in on the server so the card
 * and the table row read from the same object rather than each looking it up.
 */
export type ProjectListRow = Project & { fileCount: number };

/** Links a Blank Project to a GitHub remote it will be pushed to. */
export type ConnectGithubInput = {
  repoOwner: string;
  repoName: string;
  repoUrl: string;
  repoId?: string | null;
  defaultBranch?: string;
  visibility?: string;
  credentialId: string;
};

export const PROJECT_STATUS_LABELS: Record<ProjectKind, Record<CloneStatus, string>> = {
  blank: {
    pending: "Setting up…",
    cloning: "Setting up…",
    ready: "Ready",
    error: "Setup failed",
  },
  github: {
    pending: "Not cloned yet",
    cloning: "Cloning…",
    ready: "Ready",
    error: "Clone failed",
  },
};

/** The status label to show for a project, phrased for how it originated. */
export function projectStatusLabel(project: Pick<Project, "kind" | "cloneStatus">): string {
  return PROJECT_STATUS_LABELS[project.kind][project.cloneStatus];
}

/** One repository as offered by the picker, straight from the provider. */
export type RemoteRepo = {
  id: string;
  name: string;
  full_name: string;
  owner: string;
  clone_url: string;
  default_branch: string;
  private: boolean;
  description: string | null;
  updated_at: string | null;
};

/** Frames streamed by POST /api/projects/{id}/clone. */
export type CloneEvent =
  | { type: "clone_progress"; step: string; message: string }
  | { type: "clone_error"; message: string }
  | { type: "clone_done"; reason: string; branch?: string | null; file_count?: number };

/** What GET /api/projects/{id}/container reports, after reconciling with Docker. */
export type ContainerState = {
  exists: boolean;
  running: boolean;
  status: string;
  container_id: string | null;
  container_name: string;
  image: string | null;
  host_port: number | null;
  /** False when there is no usable daemon — a state to show, not an error. */
  docker_available: boolean;
  message: string | null;
};

/** One entry in the file tree. Directories are derived, not stored. */
export type FileNode = {
  path: string;
  name: string;
  dir_path: string;
  is_binary: boolean;
  size_bytes: number;
};

export type TreeLevel = {
  dir_path: string;
  directories: { name: string; path: string }[];
  files: FileNode[];
};

export type FileContent = {
  path: string;
  content: string;
  size_bytes: number;
};

export type GitStatus = {
  current_branch: string | null;
  branches: string[];
  dirty: boolean;
};

export type PullRequest = {
  number: number;
  title: string;
  state: string;
  html_url: string;
  head: string;
  base: string;
  draft: boolean;
};

/** A persisted transcript line, as stored by the backend. */
export type StoredMessage = {
  session_id: string;
  seq: number;
  role: "user" | "assistant" | "tool_call" | "tool_result" | "error";
  content: string | null;
  tool_name: string | null;
  tool_call_id: string | null;
  tool_args: Record<string, unknown> | null;
  is_error: boolean;
};
