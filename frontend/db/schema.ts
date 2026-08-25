/**
 * The single source of truth for application-table DDL.
 *
 * Ownership rule: Next.js writes `workflows` and only reads the run tables.
 * Python writes `workflow_runs` and `workflow_run_steps` and only reads
 * `workflows`. No table has two writers.
 *
 * LangGraph's `checkpoints*` tables are NOT modelled here — AsyncPostgresSaver
 * creates and migrates them itself. `tablesFilter` in drizzle.config.ts keeps
 * drizzle-kit from ever diffing (and proposing to drop) them.
 */

import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import type { WorkflowGraph } from "@/lib/workflow-types";

export const runStatus = pgEnum("run_status", [
  "queued",
  "running",
  "completed",
  "error",
  "cancelled",
]);

export const stepStatus = pgEnum("step_status", [
  "running",
  "ok",
  "error",
  "skipped",
  "cancelled",
]);

export const workflows = pgTable("workflows", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  graph: jsonb("graph")
    .$type<WorkflowGraph>()
    .notNull()
    .default(sql`'{"nodes":[],"edges":[]}'::jsonb`),
  /** Shape version of the JSON document, for future migrations of its layout. */
  graphVersion: integer("graph_version").notNull().default(1),
  /** Edit counter, bumped on every save. Runs record which one they used. */
  version: integer("version").notNull().default(1),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const workflowRuns = pgTable(
  "workflow_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workflowId: uuid("workflow_id")
      .notNull()
      // restrict, not cascade: deleting a workflow must not silently erase its
      // run history. Deletes are soft (archivedAt) for this reason.
      .references(() => workflows.id, { onDelete: "restrict" }),
    workflowVersion: integer("workflow_version").notNull(),
    /** LangGraph checkpoint thread id, so a run can be resumed. */
    threadId: text("thread_id").notNull(),
    status: runStatus("status").notNull().default("queued"),
    /** Cancellation lives in the database, not process memory, so it works
     *  across workers and from a second browser tab. */
    cancelRequested: boolean("cancel_requested").notNull().default(false),
    input: text("input").notNull(),
    /** The graph as it was when the run started. Editing the workflow later
     *  must not rewrite history. */
    graphSnapshot: jsonb("graph_snapshot").$type<WorkflowGraph>().notNull(),
    finalState: jsonb("final_state").$type<Record<string, unknown>>(),
    error: text("error"),
    doneReason: text("done_reason"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    index("workflow_runs_workflow_started_idx").on(t.workflowId, t.startedAt),
    index("workflow_runs_thread_idx").on(t.threadId),
  ],
);

export const workflowRunSteps = pgTable(
  "workflow_run_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => workflowRuns.id, { onDelete: "cascade" }),
    nodeId: text("node_id").notNull(),
    nodeType: text("node_type").notNull(),
    label: text("label"),
    /** Execution order within the run. */
    seq: integer("seq").notNull(),
    /** >1 when a cycle revisits the same node. */
    attempt: integer("attempt").notNull().default(1),
    status: stepStatus("status").notNull().default("running"),
    /** The RENDERED prompt, after {{ ref }} interpolation. */
    input: text("input"),
    /** Untruncated final text. Graph state only carries a truncated copy,
     *  because state is re-serialized into a checkpoint every super-step. */
    output: text("output"),
    events: jsonb("events").$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
    toolCallCount: integer("tool_call_count").notNull().default(0),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    index("workflow_run_steps_run_seq_idx").on(t.runId, t.seq),
    unique("workflow_run_steps_run_node_attempt_uq").on(t.runId, t.nodeId, t.attempt),
  ],
);

export type WorkflowRow = typeof workflows.$inferSelect;
export type WorkflowRunRow = typeof workflowRuns.$inferSelect;
export type WorkflowRunStepRow = typeof workflowRunSteps.$inferSelect;
