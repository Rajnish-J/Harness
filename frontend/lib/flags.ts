/**
 * Mock-mode flags.
 *
 * Every read below is a LITERAL `process.env.NEXT_PUBLIC_*` expression on
 * purpose. Next inlines these at build time by textual substitution, so a
 * computed lookup like process.env[`NEXT_PUBLIC_MOCK_${name}`] would silently
 * be undefined in the browser bundle — no error, just the wrong behaviour.
 * One static read per flag is the only shape that works.
 *
 * Evaluated once at module scope, never during render: reading env inside a
 * component body is exactly what react-hooks/purity exists to complain about,
 * and a module constant is also guaranteed identical between the server render
 * and the client hydration.
 *
 * Because the values are baked into the compiled module, changing one requires
 * restarting `next dev` — a hot reload will not pick it up.
 */

function on(value: string | undefined): boolean {
  return value === "true" || value === "1";
}

const ALL = on(process.env.NEXT_PUBLIC_MOCK_ALL);

export const flags = {
  mockAll: ALL,
  mockWorkflow: ALL || on(process.env.NEXT_PUBLIC_MOCK_WORKFLOW),
  mockAgents: ALL || on(process.env.NEXT_PUBLIC_MOCK_AGENTS),
  mockSkills: ALL || on(process.env.NEXT_PUBLIC_MOCK_SKILLS),
  mockMcp: ALL || on(process.env.NEXT_PUBLIC_MOCK_MCP),
  // Deliberately NOT `ALL ||`: the /tools page and composer tool picker must
  // reflect the real registry whenever NEXT_PUBLIC_MOCK_TOOLS says so, even
  // under NEXT_PUBLIC_MOCK_ALL=true, so the live tool set is never masked by
  // a stale fixture.
  mockTools: on(process.env.NEXT_PUBLIC_MOCK_TOOLS),
  mockChat: ALL || on(process.env.NEXT_PUBLIC_MOCK_CHAT),
  // Covers both memory surfaces: the /memory editor and /memory-insights.
  // Unlike the registries, memory is served by the Python harness rather than
  // Drizzle, so its fixtures stand in for the backend being down, not just
  // for an empty database.
  mockMemory: ALL || on(process.env.NEXT_PUBLIC_MOCK_MEMORY),
  // The project IDE's chrome — workspace versions, snapshots, ZIP export,
  // preview/production URLs, container vitals. Unlike the flags above this one
  // is not "mock instead of the backend": there is no backend for any of it
  // yet, so the fixtures ARE the feature until each one is built out.
  mockIde: ALL || on(process.env.NEXT_PUBLIC_MOCK_IDE),
} as const;

/**
 * One row per surface for the settings page, built from the booleans already
 * computed above rather than from fresh env reads — the literal-expression
 * rule in this file's header applies to the reads, not to what is done with
 * the results.
 */
export type MockSurface = {
  key: string;
  label: string;
  on: boolean;
  /** What serving fixtures for this surface actually replaces. */
  describes: string;
};

export const MOCK_SURFACES: MockSurface[] = [
  {
    key: "NEXT_PUBLIC_MOCK_WORKFLOW",
    label: "Workflows",
    on: flags.mockWorkflow,
    describes: "Workflow list, validation, run events and cancellation.",
  },
  {
    key: "NEXT_PUBLIC_MOCK_AGENTS",
    label: "Agents",
    on: flags.mockAgents,
    describes: "The agent registry behind /agents, read and write.",
  },
  {
    key: "NEXT_PUBLIC_MOCK_SKILLS",
    label: "Skills",
    on: flags.mockSkills,
    describes: "The skill registry behind /skills, read and write.",
  },
  {
    key: "NEXT_PUBLIC_MOCK_MCP",
    label: "MCP",
    on: flags.mockMcp,
    describes: "MCP server records and their tool discovery.",
  },
  {
    key: "NEXT_PUBLIC_MOCK_TOOLS",
    label: "Tools",
    on: flags.mockTools,
    describes:
      "The tool registry behind /tools and the composer picker. The one flag MOCK_ALL does not imply, so the live tool set is never masked by a stale fixture.",
  },
  {
    key: "NEXT_PUBLIC_MOCK_CHAT",
    label: "Chat",
    on: flags.mockChat,
    describes:
      "Streaming turns, approvals, session reset, history — and this page's harness config and model catalog.",
  },
  {
    key: "NEXT_PUBLIC_MOCK_MEMORY",
    label: "Memory",
    on: flags.mockMemory,
    describes:
      "Both memory surfaces. Served by Python rather than Drizzle, so the fixtures stand in for the backend being down, not just an empty database.",
  },
  {
    key: "NEXT_PUBLIC_MOCK_IDE",
    label: "IDE chrome",
    on: flags.mockIde,
    describes:
      "Workspace versions, container vitals, deploy URLs, share and ZIP export. There is no backend for any of it yet, so the fixtures are the feature.",
  },
];

/** True when anything is mocked — drives the header's "Mock data" badge. */
export const anyMock = Object.values(flags).some(Boolean);

/** The names of the surfaces currently mocked, for the badge tooltip. */
export function mockedSurfaces(): string[] {
  const names: string[] = [];
  if (flags.mockWorkflow) names.push("workflows");
  if (flags.mockAgents) names.push("agents");
  if (flags.mockSkills) names.push("skills");
  if (flags.mockMcp) names.push("mcp");
  if (flags.mockTools) names.push("tools");
  if (flags.mockChat) names.push("chat");
  if (flags.mockMemory) names.push("memory");
  if (flags.mockIde) names.push("ide");
  return names;
}
