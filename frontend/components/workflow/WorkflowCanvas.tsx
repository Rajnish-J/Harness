"use client";

import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
  type OnSelectionChangeParams,
} from "@xyflow/react";
import { useCallback, useMemo } from "react";

// Imported here rather than in globals.css: Tailwind v4 requires
// `@import "tailwindcss"` to lead that file, and a component-level import also
// keeps the chat route from paying for these styles.
import "@xyflow/react/dist/style.css";

import AgentNode from "./nodes/AgentNode";
import ConditionNode from "./nodes/ConditionNode";
import type { FlowNode } from "@/lib/graph-serde";

export default function WorkflowCanvas({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onSelectionChange,
  onDrop,
}: {
  nodes: FlowNode[];
  edges: Edge[];
  onNodesChange: (changes: NodeChange<FlowNode>[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  onSelectionChange: (params: OnSelectionChangeParams) => void;
  onDrop: (type: "agent" | "condition", position: { x: number; y: number }) => void;
}) {
  // Defined outside render would be better still, but these close over nothing
  // — useMemo keeps the identity stable so React Flow doesn't re-register them.
  const nodeTypes = useMemo(
    () => ({ agentNode: AgentNode, conditionNode: ConditionNode }),
    [],
  );

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData("application/harness-node");
      if (type !== "agent" && type !== "condition") return;

      const bounds = event.currentTarget.getBoundingClientRect();
      onDrop(type, {
        x: event.clientX - bounds.left - 100,
        y: event.clientY - bounds.top - 20,
      });
    },
    [onDrop],
  );

  return (
    <div
      className="h-full w-full"
      onDrop={handleDrop}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onSelectionChange={onSelectionChange}
        fitView
        proOptions={{ hideAttribution: false }}
        className="bg-zinc-50 dark:bg-zinc-950"
      >
        <Background gap={16} size={1} />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable className="!bg-white dark:!bg-zinc-900" />
      </ReactFlow>
    </div>
  );
}
