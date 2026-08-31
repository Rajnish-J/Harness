"use client";

import { Box, Clock, Cpu, Loader2, MemoryStick, Play, Plug, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useContainerState } from "@/hooks/use-container-state";
import type { ContainerVitals } from "@/lib/ide-types";
import { cn } from "@/lib/utils";

/** "28s", "4m 12s", "1h 20m" — coarse on purpose; this is a glance, not a clock. */
function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${Math.floor(seconds % 60)}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function formatMib(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))}MB`;
}

/** A filled track. Two colours only: fine, and getting close to the ceiling. */
function Meter({ value }: { value: number }) {
  return (
    <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
      <span
        className={cn(
          "block h-full rounded-full",
          value > 85 ? "bg-red-500" : "bg-emerald-500",
        )}
        style={{ width: `${Math.min(100, Math.max(2, value))}%` }}
      />
    </span>
  );
}

/** The CPU line. An inline SVG rather than a chart library for 24 points. */
function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return null;
  const max = Math.max(4, ...points);
  const step = 64 / (points.length - 1);
  const path = points
    .map((value, i) => `${i === 0 ? "M" : "L"}${i * step},${16 - (value / max) * 14}`)
    .join(" ");

  return (
    <svg width="64" height="16" viewBox="0 0 64 16" aria-hidden className="overflow-visible">
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        className="text-sky-500"
      />
    </svg>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  chart,
}: {
  icon: typeof Clock;
  label: string;
  value: string;
  chart?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-xs">
      <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="text-muted-foreground">{label}</span>
      <span className="ml-auto flex items-center gap-2">
        {chart}
        <span className="tabular-nums">{value}</span>
      </span>
    </div>
  );
}

/**
 * Where this project's commands are running: a glanceable pill, click for
 * vitals and start/stop.
 *
 * A top-level control on its own, not a line item buried in a bigger menu —
 * "is anything running" is something you check constantly, not occasionally,
 * so it earns its own place in the bar the way the git actions do.
 */
export default function ContainerMenu({
  projectId,
  vitals,
}: {
  projectId: string;
  vitals: ContainerVitals;
}) {
  const { state, busy, error, act } = useContainerState(projectId);
  const running = state?.running ?? false;
  const dockerAvailable = state?.docker_available ?? true;
  const memoryPercent = (vitals.memoryBytes / vitals.memoryLimitBytes) * 100;

  async function toggle() {
    try {
      await act(running ? "stop" : "start");
    } catch (err) {
      toast.error({
        title: `Could not ${running ? "stop" : "start"} container`,
        description: (err as Error).message,
      });
    }
  }

  if (!dockerAvailable) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="flex items-center gap-1.5 rounded-md border border-dashed px-2 py-1 text-[11px] text-muted-foreground">
            <Box className="size-3" />
            no container
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          {state?.message ??
            "Docker is not available. Commands run on the host; files and git are unaffected."}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            "h-6 gap-1.5 px-2 text-[11px]",
            running ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground",
          )}
        >
          <span
            className={cn(
              "size-1.5 rounded-full",
              running ? "bg-emerald-500" : "bg-muted-foreground/50",
            )}
          />
          {!state ? "checking…" : running ? "running" : (state?.status ?? "stopped")}
          {running && state?.host_port ? ` · :${state.host_port}` : ""}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64 p-0">
        <div className="py-1">
          <Stat icon={Clock} label="Uptime" value={formatUptime(vitals.uptimeSeconds)} />
          <Stat icon={Plug} label="Port" value={vitals.port ? String(vitals.port) : "—"} />
          <Stat
            icon={MemoryStick}
            label="Memory"
            value={formatMib(vitals.memoryBytes)}
            chart={<Meter value={memoryPercent} />}
          />
          <Stat
            icon={Cpu}
            label="CPU"
            value={`${Math.round(vitals.cpuPercent)}%`}
            chart={<Sparkline points={vitals.cpuHistory} />}
          />
        </div>
        {error && (
          <p className="px-3 pb-2 text-[11px] text-red-600 dark:text-red-400">{error}</p>
        )}

        <DropdownMenuSeparator className="my-0" />

        <div className="p-1">
          <DropdownMenuItem
            variant={running ? "destructive" : undefined}
            disabled={busy !== null || !state}
            onSelect={() => void toggle()}
          >
            {busy ? (
              <Loader2 className="animate-spin" />
            ) : running ? (
              <Square />
            ) : (
              <Play />
            )}
            {running ? "Stop container" : "Start container"}
          </DropdownMenuItem>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
