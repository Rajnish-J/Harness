/**
 * Fixture workflows and a scripted run.
 *
 * Three graphs, chosen to exercise the three states the editor can be in: a
 * plain linear pipeline, a branching one with a condition, and one that fails
 * validation so the ValidationBanner has something to render. Same literal-id
 * and literal-timestamp rule as registry.ts.
 */

import type { Workflow } from "@/lib/workflow-types";
import type { WorkflowEvent } from "@/lib/workflow-events";

export const MOCK_WORKFLOW_IDS = {
  triage: "f1a2b3c4-d5e6-4f7a-8b9c-0d1e2f3a4b01",
  release: "a2b3c4d5-e6f7-4a8b-9c0d-1e2f3a4b5c02",
  broken: "b3c4d5e6-f7a8-4b9c-0d1e-2f3a4b5c6d03",
} as const;

const T = {
  old: "2026-07-21T10:02:00.000Z",
  mid: "2026-08-09T13:48:00.000Z",
  new: "2026-08-22T17:15:00.000Z",
} as const;

export const MOCK_WORKFLOWS: Workflow[] = [
  {
    id: MOCK_WORKFLOW_IDS.triage,
    name: "Issue triage",
    description: "Read an issue, classify it, and draft a reply",
    version: 7,
    createdAt: T.old,
    updatedAt: T.new,
    graph: {
      nodes: [
        {
          id: "read",
          type: "agent",
          label: "Read the issue",
          position: { x: 80, y: 80 },
          config: {
            prompt: "Read {{ input }} and summarise the reported symptom.",
            tools: ["read_file"],
            max_iterations: 4,
            on_error: "fail",
          },
        },
        {
          id: "classify",
          type: "agent",
          label: "Classify severity",
          position: { x: 80, y: 240 },
          config: {
            prompt:
              "Given {{ read.output }}, answer with exactly one of: outage, bug, question.",
            tools: [],
            max_iterations: 2,
            on_error: "fail",
          },
        },
        {
          id: "draft",
          type: "agent",
          label: "Draft the reply",
          position: { x: 80, y: 400 },
          config: {
            prompt: "Draft a reply for a {{ classify.output }} issue.",
            tools: ["write_file"],
            on_error: "continue",
          },
        },
      ],
      edges: [
        { id: "e1", source: "read", target: "classify", branch: null },
        { id: "e2", source: "classify", target: "draft", branch: null },
      ],
    },
  },
  {
    id: MOCK_WORKFLOW_IDS.release,
    name: "Release gate",
    description: "Branch on whether the changelog is empty",
    version: 3,
    createdAt: T.old,
    updatedAt: T.mid,
    graph: {
      nodes: [
        {
          id: "collect",
          type: "agent",
          label: "Collect changes",
          position: { x: 80, y: 80 },
          config: {
            prompt: "List everything user-facing that changed.",
            tools: ["read_file", "list_directory"],
            on_error: "fail",
          },
        },
        {
          id: "gate",
          type: "condition",
          label: "Anything to ship?",
          position: { x: 80, y: 240 },
          config: {
            predicate: {
              left: { path: "collect.output" },
              op: "is_not_empty",
            },
          },
        },
        {
          id: "notes",
          type: "agent",
          label: "Write notes",
          position: { x: -80, y: 400 },
          config: {
            prompt: "Write release notes from {{ collect.output }}.",
            tools: ["write_file"],
            on_error: "fail",
          },
        },
        {
          id: "skip",
          type: "agent",
          label: "Report no-op",
          position: { x: 240, y: 400 },
          config: {
            prompt: "Reply that this release contains internal changes only.",
            tools: [],
            on_error: "continue",
          },
        },
      ],
      edges: [
        { id: "e1", source: "collect", target: "gate", branch: null },
        { id: "e2", source: "gate", target: "notes", branch: "true" },
        { id: "e3", source: "gate", target: "skip", branch: "false" },
      ],
    },
  },
  {
    id: MOCK_WORKFLOW_IDS.broken,
    name: "Orphaned node (invalid)",
    description: "Deliberately invalid, so the validation banner has a subject",
    version: 1,
    createdAt: T.mid,
    updatedAt: T.mid,
    graph: {
      nodes: [
        {
          id: "start",
          type: "agent",
          label: "Start",
          position: { x: 80, y: 80 },
          config: { prompt: "Do the thing.", tools: [], on_error: "fail" },
        },
        {
          id: "orphan",
          type: "agent",
          label: "Unreachable",
          position: { x: 320, y: 240 },
          config: { prompt: "Never runs.", tools: [], on_error: "fail" },
        },
      ],
      edges: [],
    },
  },
];

/**
 * A scripted run for the RunPanel. Mirrors the real envelope shape: inner agent
 * events are wrapped in `node_event` and tagged with their node id.
 */
export function mockRunEvents(workflowId: string): WorkflowEvent[] {
  const runId = "run-mock-0001";
  return [
    {
      type: "workflow_started",
      run_id: runId,
      workflow_id: workflowId,
      node_ids: ["read", "classify", "draft"],
    },
    {
      type: "node_started",
      node_id: "read",
      node_type: "agent",
      label: "Read the issue",
      attempt: 1,
    },
    {
      type: "node_event",
      node_id: "read",
      event: {
        type: "tool_call",
        id: "call_mock_wf_1",
        name: "read_file",
        arguments: { path: "issues/1042.md" },
      },
    },
    {
      type: "node_event",
      node_id: "read",
      event: {
        type: "tool_result",
        id: "call_mock_wf_1",
        name: "read_file",
        is_error: false,
        content:
          "# Sidebar forgets collapsed state\n\nAfter a reload the sidebar is expanded again.",
      },
    },
    {
      type: "node_finished",
      node_id: "read",
      status: "ok",
      output_preview: "The sidebar does not persist its collapsed state across reloads.",
      error: null,
      duration_ms: 2140,
    },
    { type: "edge_taken", source: "read", target: "classify", branch: null },
    {
      type: "node_started",
      node_id: "classify",
      node_type: "agent",
      label: "Classify severity",
      attempt: 1,
    },
    {
      type: "node_finished",
      node_id: "classify",
      status: "ok",
      output_preview: "bug",
      error: null,
      duration_ms: 810,
    },
    { type: "edge_taken", source: "classify", target: "draft", branch: null },
    {
      type: "node_started",
      node_id: "draft",
      node_type: "agent",
      label: "Draft the reply",
      attempt: 1,
    },
    {
      type: "node_event",
      node_id: "draft",
      event: {
        type: "tool_call",
        id: "call_mock_wf_2",
        name: "write_file",
        arguments: { path: "replies/1042.md", content: "Thanks for the report..." },
      },
    },
    {
      type: "node_event",
      node_id: "draft",
      event: {
        type: "tool_result",
        id: "call_mock_wf_2",
        name: "write_file",
        is_error: false,
        content: "Wrote 412 bytes to replies/1042.md",
      },
    },
    {
      type: "node_finished",
      node_id: "draft",
      status: "ok",
      output_preview: "Drafted a reply and saved it to replies/1042.md.",
      error: null,
      duration_ms: 3320,
    },
    {
      type: "workflow_done",
      run_id: runId,
      reason: "completed",
      node_count: 3,
      duration_ms: 6270,
    },
  ];
}
