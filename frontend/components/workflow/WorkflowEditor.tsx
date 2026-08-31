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
import { ArrowLeft, PanelLeft, PanelRight } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import NodeConfigPanel from "./NodeConfigPanel";
import NodeConnector from "./NodeConnector";
import NodePalette from "./NodePalette";
import RunPanel from "./RunPanel";
import ValidationBanner from "./ValidationBanner";
import WorkflowCanvas from "./WorkflowCanvas";
import { toast } from "@/components/ui/toast";
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
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [leftTab, setLeftTab] = useState<"configure" | "connect">("configure");

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

  const removeEdge = useCallback((edgeId: string) => {
    setEdges((current) => current.filter((e) => e.id !== edgeId));
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
      toast.success("Workflow saved");
    } catch (error) {
      // Not pushed into `issues` — that list is graph validation, and a save
      // failure (network, server) has nothing to do with the graph's shape.
      toast.error({ title: "Save failed", description: (error as Error).message });
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
    <div className="flex h-full min-h-0 flex-col font-sans">
      {/* Editor toolbar, not app navigation — the sidebar owns the links now.
          What stays here is state that belongs to this workflow. */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2.5">
        <Link
          href="/workflows"
          aria-label="Back to workflows"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <button
          type="button"
          onClick={() => setLeftPanelOpen((v) => !v)}
          aria-pressed={leftPanelOpen}
          aria-label="Toggle node palette"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <PanelLeft className="size-4" />
        </button>
        <h2 className="truncate text-sm font-semibold">{workflow.name}</h2>
        {dirty && <span className="text-[11px] text-amber-600">unsaved</span>}
        <button
          type="button"
          onClick={() => setRightPanelOpen((v) => !v)}
          aria-pressed={rightPanelOpen}
          aria-label="Toggle run panel"
          className="ml-auto rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <PanelRight className="size-4" />
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving || !dirty}
          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-30"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>

      <ValidationBanner issues={issues} onFocus={setSelectedId} />

      <div className="flex min-h-0 flex-1">
        {leftPanelOpen && (
          <aside className="flex w-64 shrink-0 flex-col border-r border-border">
            <NodePalette />
            <div className="flex shrink-0 border-b border-border text-xs">
              <button
                type="button"
                onClick={() => setLeftTab("configure")}
                className={`flex-1 px-2 py-1.5 font-medium ${
                  leftTab === "configure"
                    ? "border-b-2 border-primary text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Configure
              </button>
              <button
                type="button"
                onClick={() => setLeftTab("connect")}
                className={`flex-1 px-2 py-1.5 font-medium ${
                  leftTab === "connect"
                    ? "border-b-2 border-primary text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Connect
              </button>
            </div>
            <div className="min-h-0 flex-1">
              {leftTab === "configure" ? (
                <NodeConfigPanel
                  node={selected}
                  otherNodeIds={nodes.filter((n) => n.id !== selectedId).map((n) => n.id)}
                  onChange={patchNode}
                  onDelete={deleteNode}
                />
              ) : (
                <NodeConnector
                  nodes={nodes}
                  edges={edges}
                  onConnect={onConnect}
                  onRemoveEdge={removeEdge}
                />
              )}
            </div>
          </aside>
        )}

        <div className="h-full min-w-0 flex-1">
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
        </div>

        {rightPanelOpen && (
          <aside className="flex w-80 shrink-0 flex-col border-l border-border">
            <RunPanel
              runState={runState}
              input={input}
              onInputChange={setInput}
              onRun={run}
              onCancel={stop}
              labels={labels}
            />
          </aside>
        )}
      </div>
    </div>
  );
}
