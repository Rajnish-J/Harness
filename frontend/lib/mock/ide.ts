/**
 * Fixtures for the project IDE's chrome.
 *
 * Unlike the other modules in this folder, these do not stand in for a backend
 * that exists — nothing serves workspace versions, snapshots, ZIP export,
 * preview URLs or container vitals yet. They stand in for one that does not,
 * so the UI can be built and judged before the endpoints are written. That is
 * why `flags.mockIde` defaults to on rather than off.
 *
 * Everything is derived from the project id where it plausibly would be, so two
 * projects do not show identical numbers and the components are exercised with
 * more than one shape of data.
 */

import type {
  ContainerVitals,
  DeploymentTargets,
  RemoteOrg,
  WorkspaceShare,
  WorkspaceVersion,
} from "@/lib/ide-types";

/** A small deterministic hash, so a given project always looks the same. */
function seed(projectId: string): number {
  let hash = 0;
  for (let i = 0; i < projectId.length; i += 1) {
    hash = (hash * 31 + projectId.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function mockVersions(projectId: string): WorkspaceVersion[] {
  const s = seed(projectId);
  const count = 3;
  const now = Date.now();

  // Built oldest-first so `filesTotal` accumulates, then reversed: the menu
  // lists newest at the bottom in the reference, but every other list in this
  // app reads newest-first and mixing the two would be worse than either.
  let total = 0;
  const versions: WorkspaceVersion[] = [];
  for (let i = 0; i < count; i += 1) {
    const changed = i === 0 ? 18 + (s % 5) : (s >> (i * 3)) % 4;
    total += i === 0 ? changed : Math.max(0, changed - 1);
    versions.push({
      id: `${projectId}-v${i + 1}`,
      number: i + 1,
      filesChanged: changed,
      filesTotal: total,
      createdAt: new Date(now - (count - i) * 11 * 60_000).toISOString(),
      current: i === count - 1,
    });
  }
  return versions;
}

export function mockVitals(projectId: string, running: boolean): ContainerVitals {
  const s = seed(projectId);
  return {
    uptimeSeconds: running ? 28 + (s % 3600) : 0,
    port: running ? 443 : null,
    memoryBytes: (400 + (s % 220)) * 1024 * 1024,
    memoryLimitBytes: 2 * 1024 * 1024 * 1024,
    cpuPercent: running ? 1 + (s % 6) : 0,
    // A flat-ish line with one bump, so the sparkline has something to draw.
    cpuHistory: Array.from({ length: 24 }, (_, i) =>
      running ? Math.max(0, 2 + Math.sin((i + s) / 3) * 2 + (i === 17 ? 6 : 0)) : 0,
    ),
    running,
  };
}

export function mockDeployments(projectId: string): DeploymentTargets {
  const s = seed(projectId);
  const slug = projectId.slice(0, 8);
  return {
    previewUrl: `https://${slug}-preview.harness.dev`,
    productionUrl: s % 2 === 0 ? `https://${slug}.harness.dev` : null,
    previewLive: true,
  };
}

export function mockShare(projectId: string): WorkspaceShare {
  const s = seed(projectId);
  return {
    link: `https://harness.local/w/${projectId}`,
    // Obviously fake, and short enough to read off a screen.
    password: `hx-${s.toString(36).slice(0, 6)}`,
  };
}

export const MOCK_ORGS: RemoteOrg[] = [
  { login: "octocat", name: "Octocat" },
  { login: "harness-labs", name: "Harness Labs" },
];
