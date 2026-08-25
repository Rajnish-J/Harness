"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { memo } from "react";

import type { NodeRunState } from "@/lib/run-state";
import type { ConditionNodeConfig, Predicate } from "@/lib/workflow-types";

export type ConditionNodeData = {
  label: string;
  nodeType: "condition";
  config: ConditionNodeConfig;
  run?: NodeRunState;
};

/** Human-readable one-liner for a predicate. Display only. */
export function describePredicate(predicate: unknown): string {
  if (!predicate || typeof predicate !== "object") return "no condition";
  const p = predicate as Record<string, unknown>;

  if (Array.isArray(p.all)) return p.all.map(describePredicate).join(" AND ");
  if (Array.isArray(p.any)) return p.any.map(describePredicate).join(" OR ");
  if (p.not) return `NOT (${describePredicate(p.not)})`;

  const side = (operand: unknown): string => {
    if (!operand || typeof operand !== "object") return "?";
    const o = operand as Record<string, unknown>;
    if ("path" in o) return String(o.path);
    return JSON.stringify(o.value);
  };

  const op = String(p.op ?? "?").replace(/_/g, " ");
  return "right" in p
    ? `${side(p.left)} ${op} ${side(p.right)}`
    : `${side(p.left)} ${op}`;
}

const RING: Record<string, string> = {
  running: "border-amber-500",
  ok: "border-emerald-500",
  error: "border-red-500",
  idle: "border-black/10 dark:border-white/15",
};

function ConditionNodeImpl({ data, selected }: NodeProps) {
  const d = data as unknown as ConditionNodeData;
  const status = d.run?.status ?? "idle";
  const branch = d.run?.outputPreview;

  return (
    <div
      className={`w-52 rounded-lg border-2 border-dashed bg-white px-3 py-2 shadow-sm dark:bg-zinc-900 ${
        RING[status] ?? RING.idle
      } ${selected ? "ring-2 ring-blue-500/40" : ""}`}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2" />

      <div className="truncate text-sm font-medium">{d.label}</div>
      <p className="mt-0.5 line-clamp-2 font-mono text-[10px] text-zinc-500">
        {describePredicate((d.config as ConditionNodeConfig)?.predicate as Predicate)}
      </p>

      {branch && (
        <p
          className={`mt-1 font-mono text-[10px] ${
            branch === "true"
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-zinc-500"
          }`}
        >
          → {branch}
        </p>
      )}

      {/* Handle ids are the branch labels the backend routes on. */}
      <div className="mt-2 flex justify-between font-mono text-[10px] text-zinc-400">
        <span>true</span>
        <span>false</span>
      </div>
      <Handle
        id="true"
        type="source"
        position={Position.Right}
        style={{ top: "40%" }}
        className="!h-2 !w-2 !bg-emerald-500"
      />
      <Handle
        id="false"
        type="source"
        position={Position.Bottom}
        className="!h-2 !w-2 !bg-zinc-400"
      />
    </div>
  );
}

export default memo(ConditionNodeImpl);
