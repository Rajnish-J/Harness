"use client";

import { useState } from "react";

import AgentStepIndicator from "@/components/chat/AgentStepIndicator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { describeRun, type RunState } from "@/lib/run-state";
import type { TranscriptItem } from "@/lib/types";

/** Reuse the chat transcript renderer verbatim rather than growing a second one. */
function toTranscript(events: RunState["nodes"][string]["events"]): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  let n = 0;
  for (const event of events) {
    n += 1;
    if (event.type === "assistant_message") {
      items.push({ kind: "assistant", id: `a${n}`, text: event.text });
    } else if (event.type === "error") {
      items.push({
        kind: "error", id: `e${n}`, message: event.message, code: event.code,
      });
    } else if (event.type === "tool_call") {
      items.push({
        kind: "step", id: event.id, name: event.name,
        arguments: event.arguments, status: "running",
      });
    } else if (event.type === "tool_result") {
      const existing = items.find(
        (item) => item.kind === "step" && item.id === event.id,
      );
      if (existing && existing.kind === "step") {
        existing.status = event.is_error ? "error" : "ok";
        existing.result = event.content;
      }
    }
  }
  return items;
}

export default function RunPanel({
  runState,
  input,
  onInputChange,
  onRun,
  onCancel,
  labels,
}: {
  runState: RunState;
  input: string;
  onInputChange: (value: string) => void;
  onRun: () => void;
  onCancel: () => void;
  labels: Record<string, string>;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const running = runState.status === "running";
  const nodeIds = Object.keys(runState.nodes);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border p-3">
        <input
          className="flex-1 rounded-lg border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-ring disabled:opacity-50"
          placeholder="Input for this run…"
          value={input}
          disabled={running}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !running) onRun();
          }}
        />
        {running ? (
          <button
            type="button"
            onClick={onCancel}
            className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-sm font-medium"
          >
            Cancel
          </button>
        ) : (
          <button
            type="button"
            onClick={onRun}
            className="shrink-0 rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground"
          >
            Run
          </button>
        )}
      </div>

      <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] text-muted-foreground">
        <span>{describeRun(runState)}</span>
        {runState.runId && (
          <span className="font-mono text-muted-foreground">
            {runState.runId.slice(0, 8)}
          </span>
        )}
      </div>

      {runState.error && (
        <div className="mx-3 mb-2 rounded-lg border border-red-500/30 bg-red-500/5 px-2.5 py-1.5 text-xs text-red-700 dark:text-red-300">
          {runState.error}
        </div>
      )}

      <ScrollArea className="flex-1">
        <div className="px-2 pb-3">
          {nodeIds.length === 0 && !running && (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">
              Run the workflow to see each step here.
            </p>
          )}
          {nodeIds.map((nodeId) => {
            const node = runState.nodes[nodeId];
            const isOpen = open === nodeId;
            return (
              <div key={nodeId} className="mb-1">
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : nodeId)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent"
                >
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      node.status === "running"
                        ? "animate-pulse bg-amber-500"
                        : node.status === "ok"
                          ? "bg-emerald-500"
                          : node.status === "error"
                            ? "bg-red-500"
                            : "bg-muted-foreground"
                    }`}
                  />
                  <span className="flex-1 truncate font-medium">
                    {labels[nodeId] ?? nodeId}
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {node.toolCalls > 0 && `${node.toolCalls} tools`}
                  </span>
                  <span className="text-muted-foreground">{isOpen ? "−" : "+"}</span>
                </button>
                {isOpen && (
                  <div className="ml-3 border-l border-border pl-2">
                    {toTranscript(node.events).map((item) =>
                      item.kind === "step" ? (
                        <AgentStepIndicator key={item.id} step={item} />
                      ) : item.kind === "assistant" ? (
                        <p
                          key={item.id}
                          className="whitespace-pre-wrap px-2 py-1 text-xs text-foreground"
                        >
                          {item.text}
                        </p>
                      ) : item.kind === "error" ? (
                        <p
                          key={item.id}
                          className="px-2 py-1 text-xs text-red-600 dark:text-red-400"
                        >
                          {item.message}
                        </p>
                      ) : null,
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
