"use client";

import { Box, Loader2, Play, Square } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { containerApi } from "@/lib/project-api";
import type { ContainerState } from "@/lib/project-types";

/**
 * Never rejects. An unreachable backend is indistinguishable from a stopped
 * container as far as this badge is concerned — both mean "not running" — and
 * a rejected promise here would only give the effect something it is not
 * allowed to handle.
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
 * Where this project's commands will run, and a way to change it.
 *
 * "Docker unavailable" is a first-class state here, not an error. The project's
 * files come off the host bind-mount, so browsing, editing and git all work
 * with no daemon at all — only "run something" needs one. Rendering that as a
 * red failure would misrepresent what is actually broken (nothing, yet).
 *
 * The status is fetched rather than passed in because it is only true at the
 * moment it is read: `docker rm`, a Docker Desktop restart, or a reboot can all
 * change it without the page knowing.
 */
export default function ContainerStatusBadge({ projectId }: { projectId: string }) {
  const [state, setState] = useState<ContainerState | null>(null);
  const [busy, setBusy] = useState<"start" | "stop" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // .then(setState) rather than an async body that assigns: calling setState
  // directly inside an effect is a lint error in this repo. Same shape as
  // SkillEditor's tool fetch — the loader swallows its own failures so the
  // effect has nothing to catch.
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
    } finally {
      setBusy(null);
    }
  }

  if (!state && !error) {
    return (
      <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Loader2 className="size-3 animate-spin" />
        container…
      </span>
    );
  }

  // No daemon: say so plainly and offer nothing to press, because there is
  // nothing useful to press.
  if (state && !state.docker_available) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="flex items-center gap-1.5 rounded-md border border-dashed px-2 py-1 text-[11px] text-muted-foreground">
            <Box className="size-3" />
            no container
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          {state.message ??
            "Docker is not available. Commands run on the host; files and git are unaffected."}
        </TooltipContent>
      </Tooltip>
    );
  }

  const running = state?.running ?? false;

  return (
    <span className="flex items-center gap-1.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] ${
              running
                ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-300"
                : "text-muted-foreground"
            }`}
          >
            <span
              className={`size-1.5 rounded-full ${
                running ? "bg-emerald-500" : "bg-muted-foreground/50"
              }`}
            />
            {running ? "running" : (state?.status ?? "stopped")}
            {running && state?.host_port ? ` · :${state.host_port}` : ""}
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          {error ??
            (running
              ? `Commands run inside ${state?.container_name}.`
              : "Container stopped — commands run on the host until you start it.")}
        </TooltipContent>
      </Tooltip>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-6 px-1.5"
        disabled={busy !== null}
        onClick={() => act(running ? "stop" : "start")}
      >
        {busy ? (
          <Loader2 className="size-3 animate-spin" />
        ) : running ? (
          <Square className="size-3" />
        ) : (
          <Play className="size-3" />
        )}
      </Button>
    </span>
  );
}
