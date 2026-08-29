"use client";

import type { Connection, Edge } from "@xyflow/react";
import { useState } from "react";

import { ScrollArea } from "@/components/ui/scroll-area";
import type { FlowNode } from "@/lib/graph-serde";

const label = "text-[11px] font-medium uppercase tracking-wide text-muted-foreground";
const field =
  "w-full rounded-lg border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-ring";

export default function NodeConnector({
  nodes,
  edges,
  onConnect,
  onRemoveEdge,
}: {
  nodes: FlowNode[];
  edges: Edge[];
  onConnect: (connection: Connection) => void;
  onRemoveEdge: (edgeId: string) => void;
}) {
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [branch, setBranch] = useState<"true" | "false">("true");

  const numbered = nodes.map((n, i) => ({
    id: n.id,
    num: i + 1,
    label: n.data.label,
    isCondition: n.data.nodeType === "condition",
  }));

  const fromNode = numbered.find((n) => n.id === fromId);
  const needsBranch = fromNode?.isCondition ?? false;

  const exists = (source: string, target: string, sourceHandle: string | undefined) =>
    edges.some(
      (e) => e.source === source && e.target === target && e.sourceHandle === sourceHandle,
    );

  const sourceHandle = needsBranch ? branch : undefined;
  const canConnect =
    fromId !== "" && toId !== "" && fromId !== toId && !exists(fromId, toId, sourceHandle);

  function connect() {
    if (!canConnect) return;
    onConnect({
      source: fromId,
      target: toId,
      sourceHandle: sourceHandle ?? null,
      targetHandle: null,
    });
    setFromId("");
    setToId("");
  }

  if (nodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        Add nodes to the canvas to connect them.
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-4 p-4">
        <div>
          <label className={label}>Nodes</label>
          <ul className="mt-1.5 flex flex-col gap-1">
            {numbered.map((n) => (
              <li key={n.id} className="truncate font-mono text-[11px] text-muted-foreground">
                #{n.num} · {n.label}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <label className={label}>From</label>
          <select
            className={`${field} mt-1`}
            value={fromId}
            onChange={(e) => {
              setFromId(e.target.value);
              setBranch("true");
            }}
          >
            <option value="">select a node…</option>
            {numbered.map((n) => (
              <option key={n.id} value={n.id}>
                #{n.num} — {n.label}
              </option>
            ))}
          </select>
        </div>

        {needsBranch && (
          <div>
            <label className={label}>Branch</label>
            <select
              className={`${field} mt-1`}
              value={branch}
              onChange={(e) => setBranch(e.target.value as "true" | "false")}
            >
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          </div>
        )}

        <div>
          <label className={label}>To</label>
          <select className={`${field} mt-1`} value={toId} onChange={(e) => setToId(e.target.value)}>
            <option value="">select a node…</option>
            {numbered.map((n) => (
              <option key={n.id} value={n.id}>
                #{n.num} — {n.label}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={connect}
          disabled={!canConnect}
          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-30"
        >
          Connect
        </button>

        <div>
          <label className={label}>Existing connections</label>
          {edges.length === 0 ? (
            <p className="mt-1.5 text-[11px] text-muted-foreground">No connections yet.</p>
          ) : (
            <ul className="mt-1.5 flex flex-col gap-1">
              {edges.map((e) => {
                const from = numbered.find((n) => n.id === e.source);
                const to = numbered.find((n) => n.id === e.target);
                return (
                  <li
                    key={e.id}
                    className="flex items-center justify-between gap-2 font-mono text-[11px] text-muted-foreground"
                  >
                    <span className="truncate">
                      #{from?.num ?? "?"} → #{to?.num ?? "?"}
                      {e.sourceHandle ? ` (${e.sourceHandle})` : ""}
                    </span>
                    <button
                      type="button"
                      onClick={() => onRemoveEdge(e.id)}
                      aria-label="Remove connection"
                      className="shrink-0 rounded px-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      ×
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </ScrollArea>
  );
}
