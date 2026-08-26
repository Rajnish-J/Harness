/**
 * Fixture tool registry.
 *
 * The three built-ins carry their real schemas (mirroring
 * backend/app/agent/tools/file_tools.py) so the /tools page and the composer's
 * tool picker look exactly as they do against a live harness. The `mcp__*`
 * entries use the same `mcp__{server}__{tool}` namespacing the real MCP client
 * produces, so the UI can be built and reviewed before that lands.
 */

import type { ToolInfo } from "@/lib/workflow-api";

export const MOCK_BUILTIN_TOOLS: ToolInfo[] = [
  {
    name: "read_file",
    group: "File Operations",
    description:
      "Read a UTF-8 text file from the workspace. Paths are relative to the workspace root.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path relative to the workspace root.",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    group: "File Operations",
    description:
      "Create or overwrite a UTF-8 text file in the workspace. Parent directories are created as needed.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to the workspace root." },
        content: { type: "string", description: "Full file contents to write." },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "list_directory",
    group: "File Operations",
    description:
      "List the entries of a directory in the workspace. Defaults to the workspace root.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Directory relative to the workspace root. Defaults to '.'.",
        },
      },
      required: [],
    },
  },
];

export const MOCK_MCP_TOOLS: ToolInfo[] = [
  {
    name: "mcp__github__search_issues",
    group: "MCP · github",
    description: "[github] Search issues and pull requests with GitHub query syntax.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "e.g. 'is:open label:bug'" },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
      },
      required: ["query"],
    },
  },
  {
    name: "mcp__github__create_issue",
    group: "MCP · github",
    description: "[github] Open a new issue on the repository.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        body: { type: "string" },
        labels: { type: "array", items: { type: "string" } },
      },
      required: ["title"],
    },
  },
  {
    name: "mcp__filesystem__list_directory",
    group: "MCP · filesystem",
    description:
      "[filesystem] List a directory through the MCP filesystem server. Distinct from the built-in tool of the same base name.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
  {
    name: "mcp__postgres__query",
    group: "MCP · postgres",
    description: "[postgres] Run a read-only SQL query and return rows as JSON.",
    input_schema: {
      type: "object",
      properties: {
        sql: { type: "string", description: "A single read-only statement." },
      },
      required: ["sql"],
    },
  },
];

export const MOCK_TOOLS: ToolInfo[] = [...MOCK_BUILTIN_TOOLS, ...MOCK_MCP_TOOLS];
