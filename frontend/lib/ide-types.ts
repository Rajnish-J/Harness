/**
 * DTOs for the project IDE's chrome.
 *
 * Nothing serves these yet. They are the shapes the fixtures in lib/mock/ide.ts
 * produce and the components consume, written as if an endpoint already
 * returned them so that swapping the fixture for a real call is a change in one
 * module rather than in every component.
 *
 * Named to match what each thing IS, not what the reference screenshots call
 * it: a "version" here is a snapshot of the working tree taken when the agent
 * finished editing, which is why it carries a file count rather than a sha.
 */

/** One saved state of the working tree, as listed by the version menu. */
export type WorkspaceVersion = {
  id: string;
  /** 1-based, and shown verbatim — "Version 3". */
  number: number;
  /** How many files this version changed relative to the one before it. */
  filesChanged: number;
  /** How many files the working tree held at this version. */
  filesTotal: number;
  createdAt: string;
  /** Exactly one version is current; reverting makes a different one current. */
  current: boolean;
};

/** Live vitals for the project's container, as the status popover shows them. */
export type ContainerVitals = {
  /** Seconds since the container started. Formatted client-side. */
  uptimeSeconds: number;
  port: number | null;
  memoryBytes: number;
  /** Ceiling used to draw the memory bar. */
  memoryLimitBytes: number;
  /** 0–100. */
  cpuPercent: number;
  /** Recent CPU samples, oldest first, for the sparkline. 0–100 each. */
  cpuHistory: number[];
  running: boolean;
};

/** Where a project is published, if anywhere. */
export type DeploymentTargets = {
  previewUrl: string | null;
  productionUrl: string | null;
  /** Preview builds get a live/stale dot in the menu. */
  previewLive: boolean;
};

/** One organisation a credential can see, for the connect-repository dialog. */
export type RemoteOrg = { login: string; name: string };

/** The workspace's shareable handles. */
export type WorkspaceShare = {
  /** Deep link back into this workspace. */
  link: string;
  /** The container's access password, revealed on demand. */
  password: string;
};
