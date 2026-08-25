"use client";

import {
  ReactFlowProvider,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
} from "@xyflow/react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import NodeConfigPanel from "./NodeConfigPanel";
import NodePalette from "./NodePalette";
import RunPanel from "./RunPanel";
import ValidationBanner from "./ValidationBanner";
import WorkflowCanvas from "./WorkflowCanvas";
import {
  defaultConfigFor,
  fromReactFlow,
  newNodeId,
  toReactFlow,
  type FlowNode,
} from "@/lib/graph-serde";
import { IDLE_RUN, applyWorkflowEvent, edgeKey } from "@/lib/run-state";
import { cancelRun, saveWorkflow, streamWorkflowRun, validateGraph } from "@/lib/workflow-api";
import type { ValidationIssue, Workflow } from "@/lib/workflow-types";

export default function WorkflowEditor({ workflow }: { workflow: Workflow }) {
  const initial = useMemo(() => toReactFlow(workflow.graph), [workflow.graph]);

  const [nodes, setNodes] = useState<FlowNode[]>(initial.nodes);
  const [edges, setEdges] = useState<Edge[]>(initial.edges);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [input, setInput] = useState("");
  const [runState, dispatch] = useReducer(applyWorkflowEvent, IDLE_RUN);
  const abortRef = useRef<AbortController | null>(null);

  const selected = nodes.find((n) => n.id === selectedId) ?? null;
  const labels = useMemo(
    () => Object.fromEntries(nodes.map((n) => [n.id, n.data.label])),
    [nodes],
  );

  // ---- canvas editing --------------------------------------------------
  const onNodesChange = useCallback((changes: NodeChange<FlowNode>[]) => {
    setNodes((current) => applyNodeChanges(changes, current));
    // Selection and hover changes aren't edits — treating them as dirty would
    // mark the workflow unsaved just for clicking around.
    if (changes.some((c) => c.type !== "select" && c.type !== "dimensions")) {
      setDirty(true);
    }
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((current) => applyEdgeChanges(changes, current));
    if (changes.some((c) => c.type !== "select")) setDirty(true);
  }, []);

  const onConnect = useCallback((connection: Connection) => {
    setEdges((current) =>
      addEdge(
        {
          ...connection,
          id: `${connection.source}->${connection.target}${
            connection.sourceHandle ? `:${connection.sourceHandle}` : ""
          }`,
          label: connection.sourceHandle ?? undefined,
        },
        current,
      ),
    );
    setDirty(true);
  }, []);

  const onDrop = useCallback(
    (type: "agent" | "condition", position: { x: number; y: number }) => {
      const id = newNodeId(type);
      setNodes((current) => [
        ...current,
        {
          id,
          type: type === "condition" ? "conditionNode" : "agentNode",
          position,
          data: {
            label: type === "condition" ? "Condition" : "Agent step",
            nodeType: type,
            config: defaultConfigFor(type),
          },
        },
      ]);
      setSelectedId(id);
      setDirty(true);
    },
    [],
  );

  const patchNode = useCallback(
    (nodeId: string, patch: { label?: string; config?: unknown }) => {
      setNodes((current) =>
        current.map((node) =>
          node.id === nodeId
            ? {
                ...node,
                data: {
                  ...node.data,
                  ...(patch.label !== undefined ? { label: patch.label } : {}),
                  ...(patch.config !== undefined
                    ? { config: patch.config as FlowNode["data"]["config"] }
                    : {}),
                },
              }
            : node,
        ),
      );
      setDirty(true);
    },
    [],
  );

  const deleteNode = useCallback((nodeId: string) => {
    setNodes((current) => current.filter((n) => n.id !== nodeId));
    setEdges((current) =>
      current.filter((e) => e.source !== nodeId && e.target !== nodeId),
    );
    setSelectedId(null);
    setDirty(true);
  }, []);

  // ---- save ------------------------------------------------------------
  const save = useCallback(async () => {
    setSaving(true);
    try {
      const graph = fromReactFlow(nodes, edges);
      const result = await validateGraph(graph);
      setIssues(result.issues);
      if (!result.ok) return;
      await saveWorkflow(workflow.id, { graph });
      setDirty(false);
    } catch (error) {
      setIssues([
        {
          code: "save_failed",
          severity: "error",
          message: (error as Error).message,
          node_id: null,
          edge_id: null,
        },
      ]);
    } finally {
      setSaving(false);
    }
  }, [nodes, edges, workflow.id]);

  // Explicit save only. Autosaving on change would write on every pixel of a drag.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "s") {
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  // ---- run -------------------------------------------------------------
  const run = useCallback(async () => {
    if (dirty) await save();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await streamWorkflowRun(
        { workflowId: workflow.id, input, signal: controller.signal },
        dispatch,
      );
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        dispatch({
          type: "workflow_error",
          message: (error as Error).message,
          code: "network",
          node_id: null,
          issues: [],
        });
        dispatch({
          type: "workflow_done",
          run_id: "",
          reason: "error",
          node_count: 0,
          duration_ms: 0,
        });
      }
    } finally {
      abortRef.current = null;
    }
  }, [workflow.id, input, dirty, save]);

  const stop = useCallback(async () => {
    // Ask the server first: the flag lives in Postgres so it survives the
    // stream closing, and the loop checks it between iterations.
    if (runState.runId) await cancelRun(runState.runId);
    abortRef.current?.abort();
  }, [runState.runId]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // ---- paint live status onto the canvas -------------------------------
  // Derived during render, not synced through an effect: `nodes` stays the
  // single source of truth for the graph, and run status is layered on top.
  // The identity checks are the performance contract — an untouched node keeps
  // its exact object, so memo() on AgentNode skips its re-render.
  const paintedNodes = useMemo(
    () =>
      nodes.map((node) => {
        const run = runState.nodes[node.id];
        if (node.data.run === run) return node;
        return { ...node, data: { ...node.data, run } };
      }),
    [nodes, runState.nodes],
  );

  const paintedEdges = useMemo(
    () =>
      edges.map((edge) => {
        const taken = runState.takenEdges.includes(
          edgeKey(edge.source, edge.target, edge.sourceHandle),
        );
        return edge.animated === taken ? edge : { ...edge, animated: taken };
      }),
    [edges, runState.takenEdges],
  );

  return (
    <div className="flex h-dvh flex-col font-sans">
      <header className="flex items-center gap-3 border-b border-black/[.08] px-4 py-2.5 dark:border-white/[.12]">
        <Link href="/workflows" className="text-sm text-zinc-500 hover:underline">
          ← Workflows
        </Link>
        <h1 className="text-sm font-semibold">{workflow.name}</h1>
        {dirty && <span className="text-[11px] text-amber-600">unsaved</span>}
        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/"
            className="rounded-lg border border-black/[.10] px-3 py-1.5 text-xs dark:border-white/[.14]"
          >
            Chat
          </Link>
          <button
            type="button"
            onClick={save}
            disabled={saving || !dirty}
            className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-50 disabled:opacity-30 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </header>

      <ValidationBanner issues={issues} onFocus={setSelectedId} />

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-64 shrink-0 flex-col border-r border-black/[.08] dark:border-white/[.12]">
          <NodePalette />
          <div className="min-h-0 flex-1">
            <NodeConfigPanel
              node={selected}
              otherNodeIds={nodes.filter((n) => n.id !== selectedId).map((n) => n.id)}
              onChange={patchNode}
              onDelete={deleteNode}
            />
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <ReactFlowProvider>
            <WorkflowCanvas
              nodes={paintedNodes}
              edges={paintedEdges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onSelectionChange={({ nodes: sel }) =>
                setSelectedId(sel.length === 1 ? sel[0].id : null)
              }
              onDrop={onDrop}
            />
          </ReactFlowProvider>
        </main>

        <aside className="flex w-80 shrink-0 flex-col border-l border-black/[.08] dark:border-white/[.12]">
          <RunPanel
            runState={runState}
            input={input}
            onInputChange={setInput}
            onRun={run}
            onCancel={stop}
            labels={labels}
          />
        </aside>
      </div>
    </div>
  );
}
