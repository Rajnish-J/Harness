/**
 * Fixture data for the agent / skill / MCP registries.
 *
 * Two hard rules, both load-bearing:
 *
 * 1. NO `@/db` or `@/lib/server/*` imports. This module is reachable from the
 *    client bundle, and importing the Drizzle client would drag `pg` into the
 *    browser build.
 * 2. Ids and timestamps are LITERAL strings. `crypto.randomUUID()` or
 *    `new Date().toISOString()` at module scope evaluate separately on the
 *    server and in the browser, so /agents — which renders updatedAt-ordered
 *    rows — would hydration-mismatch.
 *
 * Fixtures are authored in DTO shape (ISO strings, from lib/registry-types.ts).
 * The `to*Row` adapters convert to the Drizzle row shape the service layer
 * returns, so there is one source of truth and two views of it.
 */

import type { Agent, McpServer, Skill } from "@/lib/registry-types";

// Stable ids, declared once and cross-referenced: agents point at these skills
// and servers, so the attachment cascade has something real to resolve.
export const MOCK_SKILL_IDS = {
  postgresReview: "5b1c9a30-1f4e-4c7a-9d21-8f0e2a7b4c11",
  houseStyle: "7d3e4f20-6a8b-4e1c-b592-0c4d7e8a9b22",
  releaseNotes: "9f5a6b10-2c3d-4a8e-8471-3e5f6a7b8c33",
  incidentTriage: "1a2b3c40-4d5e-4f60-9a81-2b3c4d5e6f44",
} as const;

export const MOCK_MCP_IDS = {
  filesystem: "c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e55",
  github: "d2e3f4a5-b6c7-4d8e-9f0a-1b2c3d4e5f66",
  postgres: "e3f4a5b6-c7d8-4e9f-a0b1-2c3d4e5f6a77",
} as const;

export const MOCK_AGENT_IDS = {
  codeReviewer: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c88",
  docsWriter: "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d99",
  sqlAnalyst: "c3d4e5f6-a7b8-4c9d-0e1f-2a3b4c5d6eaa",
  migrationBot: "d4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7fbb",
} as const;

const T = {
  oldest: "2026-07-02T09:14:00.000Z",
  old: "2026-07-19T16:41:00.000Z",
  mid: "2026-08-04T11:07:00.000Z",
  recent: "2026-08-18T14:22:00.000Z",
  newest: "2026-08-24T08:35:00.000Z",
} as const;

// ------------------------------------------------------------------ Skills

const POSTGRES_REVIEW_CONTENT = [
  "# Reviewing a Postgres migration",
  "",
  "Read the migration end to end before commenting on any single statement.",
  "",
  "## Always check",
  "",
  "1. **Is it reversible?** Dropping a column is a one-way door in production.",
  "   Ask whether it can be left in place and simply stop being written to.",
  "2. **Does it lock?** Adding a column with a volatile default rewrites the",
  "   whole table and holds an ACCESS EXCLUSIVE lock for the duration. On a",
  "   large table that is an outage, not a migration.",
  "3. **Are the indexes concurrent?** A plain index build blocks writes. Prefer",
  "   CONCURRENTLY, and remember it cannot run inside a transaction.",
  "4. **Backfills belong in their own migration.** Mixing schema changes with a",
  "   large UPDATE means the lock is held for the length of the backfill.",
  "",
  "## What to say",
  "",
  "Lead with the one thing that would page someone at 3am. Everything else is a",
  "nit and should be labelled as such.",
].join("\n");

const HOUSE_STYLE_CONTENT = [
  "# House style",
  "",
  "Write the way the existing code comments write.",
  "",
  "- Explain **why**, not what. The code already says what it does.",
  "- Name the failure the reader would otherwise hit. \"Without this, the pool",
  "  leaks one connection per HMR reload\" beats \"cache the pool\".",
  "- No hedging. \"This is probably fine\" is not a comment, it is a shrug.",
  "- Be consistent with the spelling already used in the file you are editing.",
  "- Never open a paragraph with \"Basically\" or \"Simply\".",
].join("\n");

const RELEASE_NOTES_CONTENT = [
  "# Drafting release notes",
  "",
  "Group by what the reader can now *do*, not by which file changed.",
  "",
  "## Structure",
  "",
  "**Added** - new capability, one line each, user-facing verb first.",
  "**Changed** - behaviour that differs from last release. Say what to expect.",
  "**Fixed** - the symptom, not the root cause. \"Sidebar forgot its collapsed",
  "state on reload\" beats \"fixed cookie parsing in the layout\".",
  "",
  "Skip anything invisible to a user: refactors, lockfile bumps, CI tweaks. If",
  "the release contains only those, say \"internal changes only\" and stop.",
].join("\n");

const INCIDENT_TRIAGE_CONTENT = [
  "# Triage",
  "",
  "Stop the bleeding first. Understand it second.",
  "",
  "1. What changed in the last hour? Deploys, config, feature flags.",
  "2. Is it one region, one customer, or everything?",
  "3. Can it be rolled back? If yes, roll back and investigate afterwards.",
  "",
  "Write the timeline as you go. Reconstructing it later is always worse.",
].join("\n");

export const MOCK_SKILLS: Skill[] = [
  {
    id: MOCK_SKILL_IDS.postgresReview,
    slug: "postgres-review",
    name: "Postgres migration review",
    description:
      "Use when reviewing a SQL migration or schema change before it is applied.",
    content: POSTGRES_REVIEW_CONTENT,
    allowedTools: ["read_file", "list_directory"],
    enabled: true,
    createdAt: T.oldest,
    updatedAt: T.newest,
  },
  {
    id: MOCK_SKILL_IDS.houseStyle,
    slug: "house-style",
    name: "House writing style",
    description:
      "Use whenever producing prose for this repo: comments, docs, PR bodies.",
    content: HOUSE_STYLE_CONTENT,
    allowedTools: [],
    enabled: true,
    createdAt: T.old,
    updatedAt: T.recent,
  },
  {
    id: MOCK_SKILL_IDS.releaseNotes,
    slug: "release-notes",
    name: "Release notes",
    description: "Use when drafting a changelog entry or a release summary.",
    content: RELEASE_NOTES_CONTENT,
    allowedTools: ["read_file"],
    enabled: true,
    createdAt: T.mid,
    updatedAt: T.mid,
  },
  {
    id: MOCK_SKILL_IDS.incidentTriage,
    slug: "incident-triage",
    name: "Incident triage",
    description: "Use when something is broken in production and time matters.",
    content: INCIDENT_TRIAGE_CONTENT,
    allowedTools: ["read_file", "list_directory"],
    enabled: false,
    createdAt: T.old,
    updatedAt: T.old,
  },
];

// ------------------------------------------------------------- MCP servers

export const MOCK_MCP_SERVERS: McpServer[] = [
  {
    id: MOCK_MCP_IDS.filesystem,
    name: "filesystem",
    description: "Local filesystem access scoped to the harness workspace",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "./workspace"],
    url: null,
    env: {},
    headers: {},
    credentialId: null,
    enabled: true,
    createdAt: T.oldest,
    updatedAt: T.newest,
  },
  {
    id: MOCK_MCP_IDS.github,
    name: "github",
    description: "Issues and pull requests on the Harness repository",
    transport: "http",
    command: null,
    args: [],
    url: "https://api.githubcopilot.com/mcp/",
    env: {},
    headers: { Authorization: "Bearer ghp_mockmockmockmockmock" },
    credentialId: null,
    enabled: true,
    createdAt: T.old,
    updatedAt: T.recent,
  },
  {
    id: MOCK_MCP_IDS.postgres,
    name: "postgres",
    description: "Read-only SQL against the harness database",
    transport: "sse",
    command: null,
    args: [],
    url: "http://localhost:8931/sse",
    env: { PG_READONLY_URL: "postgresql://readonly@localhost:5432/harness" },
    headers: {},
    credentialId: null,
    enabled: false,
    createdAt: T.mid,
    updatedAt: T.mid,
  },
];

// ------------------------------------------------------------------ Agents

const CODE_REVIEWER_PROMPT = [
  "You are reviewing code in the Harness repository.",
  "",
  "Report defects, not preferences. A finding must name a concrete failure: the",
  "input, the state, and the wrong output or crash that results. If you cannot",
  "name one, it is a nit - say so explicitly or leave it out.",
  "",
  "Rank by severity. A correctness bug outranks every style observation, and the",
  "reader should see it first.",
  "",
  "Read the surrounding file before commenting on a line. Code that looks wrong",
  "in isolation is usually consistent with a convention you have not read yet.",
  "",
  "Never propose a rewrite when a two-line fix exists.",
].join("\n");

const DOCS_WRITER_PROMPT = [
  "You write documentation for Harness.",
  "",
  "Assume the reader is a competent engineer who has not seen this codebase. Do",
  "not explain what a database is; do explain why this one is optional.",
  "",
  "Every claim about behaviour must be traceable to code you have read. If you",
  "are unsure whether something is still true, read the file rather than hedging.",
].join("\n");

const SQL_ANALYST_PROMPT = [
  "You answer questions about the Harness database.",
  "",
  "Read-only. Never propose a statement that modifies data or schema.",
  "",
  "Show the query you ran before the answer it produced. A number without its",
  "query is not an answer.",
].join("\n");

export const MOCK_AGENTS: Agent[] = [
  {
    id: MOCK_AGENT_IDS.codeReviewer,
    slug: "code-reviewer",
    name: "Code Reviewer",
    description: "Reads a diff and reports only what would actually bite you",
    systemPrompt: CODE_REVIEWER_PROMPT,
    model: null,
    maxIterations: null,
    toolNames: ["read_file", "list_directory"],
    skillIds: [MOCK_SKILL_IDS.postgresReview, MOCK_SKILL_IDS.houseStyle],
    mcpServerIds: [MOCK_MCP_IDS.github],
    enabled: true,
    createdAt: T.oldest,
    updatedAt: T.newest,
  },
  {
    id: MOCK_AGENT_IDS.docsWriter,
    slug: "docs-writer",
    name: "Docs Writer",
    description: "Writes and maintains the prose in this repo",
    systemPrompt: DOCS_WRITER_PROMPT,
    model: null,
    maxIterations: null,
    toolNames: ["read_file", "write_file", "list_directory"],
    skillIds: [MOCK_SKILL_IDS.houseStyle, MOCK_SKILL_IDS.releaseNotes],
    mcpServerIds: [],
    enabled: true,
    createdAt: T.old,
    updatedAt: T.recent,
  },
  {
    id: MOCK_AGENT_IDS.sqlAnalyst,
    slug: "sql-analyst",
    name: "SQL Analyst",
    description: "Answers questions about the data. Cheap model, short leash.",
    systemPrompt: SQL_ANALYST_PROMPT,
    model: "claude-haiku-4-5",
    maxIterations: 4,
    toolNames: [],
    skillIds: [MOCK_SKILL_IDS.postgresReview],
    mcpServerIds: [MOCK_MCP_IDS.postgres],
    enabled: true,
    createdAt: T.mid,
    updatedAt: T.mid,
  },
  {
    id: MOCK_AGENT_IDS.migrationBot,
    slug: "migration-bot",
    name: "Migration Bot",
    description: "Retired - superseded by Code Reviewer",
    systemPrompt: "You write Drizzle migrations.",
    model: null,
    maxIterations: 6,
    toolNames: ["read_file", "write_file"],
    skillIds: [],
    mcpServerIds: [],
    enabled: false,
    createdAt: T.oldest,
    updatedAt: T.old,
  },
];

// ---------------------------------------------------------------- Adapters
//
// The service layer hands back Drizzle rows, whose timestamps are Date objects
// that the pages call .toISOString() on. Fixtures are authored in DTO shape, so
// these adapt one to the other.

export type SkillRowShape = Omit<Skill, "createdAt" | "updatedAt"> & {
  createdAt: Date;
  updatedAt: Date;
};
export type McpRowShape = Omit<McpServer, "createdAt" | "updatedAt"> & {
  createdAt: Date;
  updatedAt: Date;
};
export type AgentRowShape = Omit<Agent, "createdAt" | "updatedAt"> & {
  createdAt: Date;
  updatedAt: Date;
};

export function toSkillRow(skill: Skill): SkillRowShape {
  return {
    ...skill,
    createdAt: new Date(skill.createdAt),
    updatedAt: new Date(skill.updatedAt),
  };
}

export function toMcpRow(server: McpServer): McpRowShape {
  return {
    ...server,
    createdAt: new Date(server.createdAt),
    updatedAt: new Date(server.updatedAt),
  };
}

export function toAgentRow(agent: Agent): AgentRowShape {
  return {
    ...agent,
    createdAt: new Date(agent.createdAt),
    updatedAt: new Date(agent.updatedAt),
  };
}
