/**
 * DTOs for projects.
 *
 * Same split as lib/registry-types.ts and lib/credential-types.ts: dates cross
 * the wire as ISO strings, so these are not the Drizzle row types.
 */

import type { CredentialProvider } from "./credential-types";

export type CloneStatus = "pending" | "cloning" | "ready" | "error";

export type Project = {
  id: string;
  name: string;
  slug: string;
  provider: CredentialProvider;
  repoOwner: string;
  repoName: string;
  repoUrl: string;
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

export type ProjectInput = {
  name: string;
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

export const CLONE_STATUS_LABELS: Record<CloneStatus, string> = {
  pending: "Not cloned yet",
  cloning: "Cloning…",
  ready: "Ready",
  error: "Clone failed",
};

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
