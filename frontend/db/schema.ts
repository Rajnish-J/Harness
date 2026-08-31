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
// Projects: working trees the agent can work inside — either cloned from
// GitHub or started blank.
//
// `projects` is operator config, so Next.js writes it. `project_files` is
// derived from what is on disk, so Python — which does the cloning or the
// `git init` — writes that. Same split as workflows/workflow_runs, and for the
// same reason: the side that produces the data is the side that owns the
// table.
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

/**
 * How a project came to exist. `blank` starts from nothing but a local git
 * init; `github` starts from a clone. A `blank` project can later be linked to
 * a GitHub remote (see `repoUrl`) without becoming a `github` row — `kind`
 * records provenance, not the project's current connection state.
 */
export const projectKind = pgEnum("project_kind", ["blank", "github"]);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    kind: projectKind("kind").notNull().default("github"),
    provider: credentialProvider("provider").notNull().default("github"),
    /** Null until a Blank Project is connected to a remote. */
    repoOwner: text("repo_owner"),
    repoName: text("repo_name"),
    /** Clean HTTPS remote. The token is NEVER interpolated into this. */
    repoUrl: text("repo_url"),
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

// ---------------------------------------------------------------------------
// Project environment variables: a project's .env, stored per key.
//
// Sibling of `credentials`, not a variant of it. A credential is a token the
// HARNESS replays to a provider — it has a username, an account, scopes and a
// verdict from the last connection test. An env var is a string the PROJECT
// reads at runtime; none of those five columns mean anything for it, and a
// nullable `project_id` bolted onto `credentials` would have made every one of
// them nullable-and-meaningless for half the rows.
//
// Rows per key rather than one blob per project, so the UI can list, filter,
// sort and delete a single variable, and so `updated_at` is per variable — the
// question "when did DATABASE_URL last change" has an answer.
//
// Values use the SAME AES-256-GCM envelope as `credentials.secret_ciphertext`
// (lib/server/crypto.ts / backend/app/core/secrets.py), so Python can decrypt
// them when it writes the container's .env. `secret` decides only whether the
// plaintext is ever served BACK to the browser: `NODE_ENV=production` is worth
// reading in the UI, a database password is not. Encryption at rest does not
// depend on it.
// ---------------------------------------------------------------------------

export const projectEnvVars = pgTable(
  "project_env_vars",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** POSIX-ish env name: A-Z, 0-9, underscore. Enforced by the route. */
    key: text("key").notNull(),
    /** `v1.<base64url nonce>.<base64url ciphertext||tag>`, as for credentials. */
    valueCiphertext: text("value_ciphertext").notNull(),
    /** Last 4 characters, so a secret can be identified without decrypting. */
    lastFour: text("last_four").notNull(),
    /** Masked in the UI and never returned in full. Cleared for a value like a
     *  hostname or a feature flag, which is more useful visible than hidden. */
    secret: boolean("secret").notNull().default(true),
    /** Optional note — what this variable is for. */
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // Also the (project_id, key) index every list query wants — a separate index
  // on project_id alone would be a redundant leftmost prefix of this one.
  (t) => [unique("project_env_vars_project_key_uq").on(t.projectId, t.key)],
);

export type ProjectEnvVarRow = typeof projectEnvVars.$inferSelect;

// ---------------------------------------------------------------------------
// Project containers: where a project's commands actually run.
//
// Python-owned. The truth about a container is whether the Docker daemon has
// one, and only the side that talks to the daemon knows that — Next.js reads
// these rows to render status and never writes them.
//
// Rows are a CACHE of daemon state, not the state itself. A container can be
// removed by `docker rm` or a Docker Desktop restart without anything telling
// us, so every read reconciles against the daemon rather than trusting the row.
// ---------------------------------------------------------------------------

export const containerStatus = pgEnum("container_status", [
  "creating",
  "running",
  "stopped",
  "error",
  "removed",
]);

export const projectContainers = pgTable(
  "project_containers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** Docker's own 64-char id. Null until the daemon has actually created it. */
    containerId: text("container_id"),
    /** Deterministic: harness-project-<project id>, so an orphan is findable. */
    containerName: text("container_name").notNull(),
    image: text("image").notNull(),
    status: containerStatus("status").notNull().default("creating"),
    /** Chosen by Docker, read back after start. Null when nothing is published. */
    hostPort: integer("host_port"),
    /** The host directory bind-mounted at /workspace. */
    workspacePath: text("workspace_path"),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    stoppedAt: timestamp("stopped_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One live container per project. Partial-unique would be better but Drizzle
    // has no first-class support, and a project only ever has one anyway.
    unique("project_containers_project_uq").on(t.projectId),
    index("project_containers_status_idx").on(t.status),
  ],
);

export type ProjectContainerRow = typeof projectContainers.$inferSelect;

// ---------------------------------------------------------------------------
// Project chat: durable conversations about a repository.
//
// Both Python-owned. Until now the SessionStore was explicitly in-memory and a
// backend restart lost everything, which is tolerable for a scratch chat and
// not for a conversation about a codebase you are midway through changing.
//
// TWO tables, because they answer two different questions:
//
//   project_chat_sessions  -> what the MODEL needs to continue the conversation
//   project_chat_messages  -> what the PAGE needs to repaint what you saw
//
// The first holds a provider-native message list, which is Anthropic-shaped or
// OpenAI-shaped and not meaningfully queryable. The second holds the rendered
// transcript. Storing only the first would mean reconstructing the UI from a
// provider's wire format; storing only the second would mean the agent could
// not actually resume.
// ---------------------------------------------------------------------------

export const chatRole = pgEnum("chat_role", [
  "user",
  "assistant",
  "tool_call",
  "tool_result",
  "error",
]);

export const projectChatSessions = pgTable(
  "project_chat_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Null for the global chat on `/` — it has no project to belong to. */
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    /** The id the browser holds in localStorage. */
    sessionId: text("session_id").notNull(),
    /** Anthropic and OpenAI histories are not interchangeable, and replaying
     *  one through the other is refused — so the provider is stored with it. */
    provider: text("provider").notNull(),
    /** Provider-native messages. Opaque here on purpose: this is the LLM's
     *  format, and parsing it in SQL would couple the schema to a vendor. */
    history: jsonb("history").$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("project_chat_sessions_session_uq").on(t.sessionId),
    index("project_chat_sessions_project_idx").on(t.projectId, t.updatedAt),
  ],
);

export const projectChatMessages = pgTable(
  "project_chat_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Null for the global chat on `/` — it has no project to belong to. */
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    sessionId: text("session_id").notNull(),
    /** Order within the session. Not a timestamp: two events inside one turn
     *  can share a millisecond, and the transcript order must be exact. */
    seq: integer("seq").notNull(),
    role: chatRole("role").notNull(),
    content: text("content"),
    toolName: text("tool_name"),
    /** The provider's id for the call, so a result folds into its own step. */
    toolCallId: text("tool_call_id"),
    toolArgs: jsonb("tool_args").$type<Record<string, unknown>>(),
    isError: boolean("is_error").notNull().default(false),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("project_chat_messages_session_seq_idx").on(t.sessionId, t.seq),
    unique("project_chat_messages_session_seq_uq").on(t.sessionId, t.seq),
  ],
);

export type ProjectChatSessionRow = typeof projectChatSessions.$inferSelect;
export type ProjectChatMessageRow = typeof projectChatMessages.$inferSelect;
