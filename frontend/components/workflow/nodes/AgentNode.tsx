"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { memo, useState } from "react";

import type { NodeRunState } from "@/lib/run-state";
import type { AgentNodeConfig } from "@/lib/workflow-types";

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export type AgentNodeData = {
  label: string;
  nodeType: "agent";
  config: AgentNodeConfig;
  /** Live status only — never the transcript. See lib/run-state.ts. */
  run?: NodeRunState;
};

const RING: Record<string, string> = {
  running: "border-amber-500 shadow-[0_0_0_3px_rgba(245,158,11,0.15)]",
  ok: "border-emerald-500",
  error: "border-red-500",
  cancelled: "border-muted-foreground",
  skipped: "border-border opacity-50",
  idle: "border-border",
};

function AgentNodeImpl({ data, selected }: NodeProps) {
  const d = data as unknown as AgentNodeData;
  const [expanded, setExpanded] = useState(false);
  const status = d.run?.status ?? "idle";
  const tools = d.config?.tools;

  const durationMs =
    d.run?.startedAt && d.run?.finishedAt ? d.run.finishedAt - d.run.startedAt : null;
  const invokedTools = [
    ...new Set(
      (d.run?.events ?? [])
        .filter((e) => e.type === "tool_call")
        .map((e) => e.name),
    ),
  ];

  return (
    <div
      className={`w-56 rounded-lg border-2 bg-card px-3 py-2 shadow-sm transition-colors ${
        RING[status] ?? RING.idle
      } ${selected ? "ring-2 ring-blue-500/40" : ""}`}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2" />

      <div className="flex items-center gap-1.5">
        {status === "running" && (
          <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-amber-500" />
        )}
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{d.label}</span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
          aria-label={expanded ? "Collapse audit info" : "Expand audit info"}
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        </button>
      </div>

      <div className="mt-1 flex flex-wrap gap-1">
        {(tools === null || tools === undefined || tools.length === 0) && (
          <span className="rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-muted-foreground">
            all tools
          </span>
        )}
        {tools?.map((tool) => (
          <span
            key={tool}
            className="rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-muted-foreground"
          >
            {tool}
          </span>
        ))}
      </div>

      {d.run?.currentTool && (
        <p className="mt-1 truncate font-mono text-[10px] text-amber-600 dark:text-amber-400">
          → {d.run.currentTool}
        </p>
      )}
      {status === "error" && d.run?.error && (
        <p className="mt-1 line-clamp-2 text-[10px] text-red-600 dark:text-red-400">
          {d.run.error}
        </p>
      )}
      {status === "ok" && d.run?.outputPreview && (
        <p className="mt-1 line-clamp-2 text-[10px] text-muted-foreground">
          {d.run.outputPreview}
        </p>
      )}

      {expanded && (
        <div className="mt-2 flex flex-col gap-1 border-t border-border pt-2 text-[10px] text-muted-foreground">
          <div className="flex justify-between">
            <span>Duration</span>
            <span className="font-mono">
              {durationMs !== null
                ? formatDuration(durationMs)
                : status === "running"
                  ? "running…"
                  : "not run yet"}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Tokens</span>
            <span className="font-mono">
              {d.run?.inputTokens !== undefined || d.run?.outputTokens !== undefined
                ? `${d.run?.inputTokens ?? 0} in / ${d.run?.outputTokens ?? 0} out`
                : "unavailable"}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Tool calls</span>
            <span className="font-mono">{d.run?.toolCalls ?? 0}</span>
          </div>
          <div>
            <span>Used this run</span>
            <div className="mt-1 flex flex-wrap gap-1">
              {invokedTools.length === 0 ? (
                <span className="italic">no tools called</span>
              ) : (
                invokedTools.map((tool) => (
                  <span
                    key={tool}
                    className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]"
                  >
                    {tool}
                  </span>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      <Handle type="source" position={Position.Right} className="!h-2 !w-2" />
    </div>
  );
}

// memo() is half the canvas performance contract; the reducer's structural
// sharing is the other half. Without both, every streamed event re-renders
// every node on the canvas.
export default memo(AgentNodeImpl);
