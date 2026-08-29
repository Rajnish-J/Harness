/**
 * The single source of truth for application-table DDL.
 *
 * Ownership rule: Next.js writes `workflows`, `mcp_servers`, `skills` and
 * `agents`, and only reads the run tables. Python writes `workflow_runs` and
 * `workflow_run_steps` and only reads `workflows`. No table has two writers.
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
    durationMs: integer("duration_ms").notNull().default(0),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
  },
  (t) => [
    index("workflow_run_steps_run_seq_idx").on(t.runId, t.seq),
    unique("workflow_run_steps_run_node_attempt_uq").on(t.runId, t.nodeId, t.attempt),
  ],
);

export type WorkflowRow = typeof workflows.$inferSelect;
export type WorkflowRunRow = typeof workflowRuns.$inferSelect;
export type WorkflowRunStepRow = typeof workflowRunSteps.$inferSelect;

// ---------------------------------------------------------------------------
// Registries: MCP servers, skills, agents.
//
// These are configuration the operator edits in the UI and the harness reads.
// Unlike `workflows` they have no dependents, so deletes are hard deletes —
// soft deletion would only buy a permanently burned unique slug.
// ---------------------------------------------------------------------------

export const mcpTransport = pgEnum("mcp_transport", ["stdio", "sse", "http"]);

export const mcpServers = pgTable(
  "mcp_servers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description"),
    transport: mcpTransport("transport").notNull().default("stdio"),
    /** stdio: the executable and its argv. Null for sse/http. */
    command: text("command"),
    args: jsonb("args").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    /** sse/http: the endpoint. Null for stdio. */
    url: text("url"),
    /** Holds API keys in plaintext. This is a localhost dev harness, so the
     *  mitigation is scope, not encryption: the list endpoint masks values and
     *  only the detail endpoint returns them. */
    env: jsonb("env")
      .$type<Record<string, string>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    headers: jsonb("headers")
      .$type<Record<string, string>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("mcp_servers_name_uq").on(t.name)],
);

export const skills = pgTable(
  "skills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    /** The "when to use this" line, cheap enough to always keep in context. */
    description: text("description"),
    /** Markdown body. text, not jsonb — it is a document, not structure. */
    content: text("content").notNull().default(""),
    /** Tool names from GET /api/workflows/tools. Free-form strings and NOT a
     *  foreign key: the tool registry lives in Python, not in this database. */
    allowedTools: jsonb("allowed_tools")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("skills_slug_uq").on(t.slug)],
);

export const agents = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    systemPrompt: text("system_prompt").notNull().default(""),
    /** Null means inherit the harness default from GET /api/config. */
    model: text("model"),
    maxIterations: integer("max_iterations"),
    toolNames: jsonb("tool_names")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** Attachments held as id arrays rather than join tables: it keeps this to
     *  three tables and means deleting a skill is never blocked by an FK. The
     *  cost is dangling ids, which the editors drop when they resolve them. */
    skillIds: jsonb("skill_ids")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    mcpServerIds: jsonb("mcp_server_ids")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("agents_slug_uq").on(t.slug)],
);

export type McpServerRow = typeof mcpServers.$inferSelect;
export type SkillRow = typeof skills.$inferSelect;
export type AgentRow = typeof agents.$inferSelect;

// ---------------------------------------------------------------------------
// Credentials: personal access tokens for GitHub and friends.
//
// Unlike `mcp_servers.env` above — which stores API keys in plaintext and
// mitigates by scope — a PAT can push code and merge pull requests, so the
// secret is encrypted at rest with AES-256-GCM (see lib/server/crypto.ts and
// backend/app/core/secrets.py, which must agree byte for byte).
//
// It is ENCRYPTED, not hashed: the token has to be replayed to GitHub, so a
// one-way digest would be useless. Next.js encrypts on write, Python decrypts
// when it needs to call an API. The plaintext is never sent back to the browser
// by any endpoint — `lastFour` exists so the UI can identify a token without
// one.
// ---------------------------------------------------------------------------

export const credentialProvider = pgEnum("credential_provider", [
  "github",
  "azure_devops",
  "gitlab",
  "generic",
]);

export const credentials = pgTable(
  "credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    provider: credentialProvider("provider").notNull().default("github"),
    /** The account the token belongs to. Needed to build an HTTPS clone URL. */
    username: text("username"),
    /** `v1.<base64url nonce>.<base64url ciphertext||tag>`. Never leaves the server. */
    secretCiphertext: text("secret_ciphertext").notNull(),
    /** Last 4 characters, so the list can render `ghp_••••1234` without decrypting. */
    lastFour: text("last_four").notNull(),
    /** Reported by the provider on a connection test, not requested by us. */
    scopes: jsonb("scopes").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    enabled: boolean("enabled").notNull().default(true),
    lastValidatedAt: timestamp("last_validated_at", { withTimezone: true }),
    lastValidationError: text("last_validation_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("credentials_name_uq").on(t.name)],
);

export type CredentialRow = typeof credentials.$inferSelect;

// ---------------------------------------------------------------------------
// Projects: cloned repositories the agent can work inside.
//
// `projects` is operator config, so Next.js writes it. `project_files` is
// derived from a clone on disk, so Python — which does the cloning — writes
// that. Same split as workflows/workflow_runs, and for the same reason: the
// side that produces the data is the side that owns the table.
//
// Deletes are soft (archivedAt), unlike the registries: a project has dependent
// rows, and a container or an indexed tree outliving its project row is a worse
// failure than a burned slug.
// ---------------------------------------------------------------------------

export const cloneStatus = pgEnum("clone_status", [
  "pending",
  "cloning",
  "ready",
  "error",
]);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    provider: credentialProvider("provider").notNull().default("github"),
    repoOwner: text("repo_owner").notNull(),
    repoName: text("repo_name").notNull(),
    /** Clean HTTPS remote. The token is NEVER interpolated into this. */
    repoUrl: text("repo_url").notNull(),
    /** The provider's own id, as text. Survives a repository being renamed. */
    repoId: text("repo_id"),
    defaultBranch: text("default_branch").notNull().default("main"),
    visibility: text("visibility").notNull().default("private"),
    /** set null, not cascade: deleting a credential must not delete work. The
     *  project simply cannot sync until another one is linked. */
    credentialId: uuid("credential_id").references(() => credentials.id, {
      onDelete: "set null",
    }),
    cloneStatus: cloneStatus("clone_status").notNull().default("pending"),
    cloneError: text("clone_error"),
    /** Checked out in the working tree right now — not necessarily the default. */
    currentBranch: text("current_branch"),
    lastPulledAt: timestamp("last_pulled_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("projects_slug_uq").on(t.slug),
    index("projects_archived_updated_idx").on(t.archivedAt, t.updatedAt),
  ],
);

/**
 * A per-file index of a cloned repository.
 *
 * Deliberately holds no file CONTENT. The working tree on disk is the source of
 * truth for bytes; duplicating them here would double the storage, go stale the
 * moment the agent edits a file, and buy nothing, because reading a file off
 * disk is already fast. What the database is genuinely better at is the SHAPE of
 * the repo — rendering a 5,000-file tree without walking the filesystem on every
 * keystroke — and cheap change detection, via the blob sha git already computed.
 */
export const projectFiles = pgTable(
  "project_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** Repo-relative, always forward slashes, even when indexed on Windows. */
    path: text("path").notNull(),
    /** Parent directory, so one level of the tree is a single indexed query. */
    dirPath: text("dir_path").notNull().default(""),
    name: text("name").notNull(),
    ext: text("ext"),
    sizeBytes: integer("size_bytes").notNull().default(0),
    /** Binary files are listed but never opened in the editor. */
    isBinary: boolean("is_binary").notNull().default(false),
    /** git's own object id. Re-indexing compares this instead of re-reading. */
    gitBlobSha: text("git_blob_sha"),
    indexedAt: timestamp("indexed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("project_files_project_path_uq").on(t.projectId, t.path),
    index("project_files_project_dir_idx").on(t.projectId, t.dirPath),
  ],
);

export type ProjectRow = typeof projects.$inferSelect;
export type ProjectFileRow = typeof projectFiles.$inferSelect;
