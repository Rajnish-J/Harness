"use client";

import { useEffect, useState } from "react";

import { containerApi } from "@/lib/project-api";
import type { ContainerState } from "@/lib/project-types";

/**
 * Never rejects. An unreachable backend is indistinguishable from a stopped
 * container as far as a caller of this hook is concerned — both mean "not
 * running" — and a rejected promise here would only give the effect something
 * it is not allowed to handle.
 */
async function loadStatus(
  projectId: string,
  signal: AbortSignal,
): Promise<ContainerState | null> {
  try {
    return await containerApi.status(projectId, signal);
  } catch {
    return null;
  }
}

/**
 * Where this project's commands are running, and a way to change it.
 *
 * Shared by ProjectOverflowMenu's trigger (a glanceable status dot) and its
 * menu content (the full status line, vitals, and start/stop action) — one
 * fetch, not two. The status is fetched rather than passed in because it is
 * only true at the moment it is read: `docker rm`, a Docker Desktop restart,
 * or a reboot can all change it without the page knowing.
 */
export function useContainerState(projectId: string) {
  const [state, setState] = useState<ContainerState | null>(null);
  const [busy, setBusy] = useState<"start" | "stop" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    loadStatus(projectId, controller.signal).then(setState);
    return () => controller.abort();
  }, [projectId]);

  async function act(action: "start" | "stop") {
    setBusy(action);
    setError(null);
    try {
      setState(await containerApi[action](projectId));
    } catch (err) {
      setError((err as Error).message);
      throw err;
    } finally {
      setBusy(null);
    }
  }

  return { state, busy, error, act };
}
