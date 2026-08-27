/**
 * Fixture tool registry.
 *
 * The built-ins carry their real schemas (mirroring
 * backend/app/agent/tools/{file_tools,search_tools,shell_tools,git_tools}.py)
 * so the /tools page and the composer's tool picker look exactly as they do
 * against a live harness. The `mcp__*` entries use the same
 * `mcp__{server}__{tool}` namespacing the real MCP client produces, so the UI
 * can be built and reviewed before that lands.
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
  {
    name: "edit_file",
    group: "File Operations",
    description:
      "Replace an exact substring within a file. old_string must match exactly once " +
      "unless replace_all is true; include enough surrounding context to make it " +
      "unique. Paths are relative to the workspace root.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to the workspace root." },
        old_string: { type: "string", description: "Exact text to find." },
        new_string: { type: "string", description: "Text to replace it with." },
        replace_all: {
          type: "boolean",
          description: "Replace every occurrence instead of requiring exactly one.",
        },
      },
      required: ["path", "old_string", "new_string"],
    },
  },
  {
    name: "delete_file",
    group: "File Operations",
    description: "Delete a single file from the workspace. Refuses directories.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to the workspace root." },
      },
      required: ["path"],
    },
  },
  {
    name: "move_file",
    group: "File Operations",
    description:
      "Move or rename a file within the workspace. Refuses to overwrite an existing " +
      "destination unless overwrite is true.",
    input_schema: {
      type: "object",
      properties: {
        src: { type: "string", description: "Source file path relative to the workspace root." },
        dest: {
          type: "string",
          description: "Destination file path relative to the workspace root.",
        },
        overwrite: { type: "boolean", description: "Overwrite dest if it already exists." },
      },
      required: ["src", "dest"],
    },
  },
  {
    name: "copy_file",
    group: "File Operations",
    description:
      "Copy a file within the workspace. Refuses to overwrite an existing destination " +
      "unless overwrite is true.",
    input_schema: {
      type: "object",
      properties: {
        src: { type: "string", description: "Source file path relative to the workspace root." },
        dest: {
          type: "string",
          description: "Destination file path relative to the workspace root.",
        },
        overwrite: { type: "boolean", description: "Overwrite dest if it already exists." },
      },
      required: ["src", "dest"],
    },
  },
  {
    name: "make_directory",
    group: "File Operations",
    description: "Create a directory in the workspace, including any missing parents.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory path relative to the workspace root." },
      },
      required: ["path"],
    },
  },
  {
    name: "search_files",
    group: "Validation",
    description:
      "Search text files under a workspace path for a regular expression and return " +
      "matching lines as path:line: text. Skips .git, node_modules, and similar noise " +
      "directories.",
    input_schema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Regular expression to search for." },
        path: {
          type: "string",
          description: "Directory or file to search under. Defaults to the workspace root.",
        },
        case_sensitive: {
          type: "boolean",
          description: "Whether the match is case-sensitive. Defaults to true.",
        },
        max_results: {
          type: "integer",
          description: "Maximum number of matching lines to return. Defaults to 200.",
        },
      },
      required: ["pattern"],
    },
  },
  {
    name: "glob_files",
    group: "Validation",
    description: "Find files under a workspace path matching a glob pattern (e.g. '**/*.py').",
    input_schema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Glob pattern, e.g. '**/*.py' or 'src/*.ts'." },
        path: {
          type: "string",
          description: "Base directory to glob under. Defaults to the workspace root.",
        },
        max_results: {
          type: "integer",
          description: "Maximum number of paths to return. Defaults to 200.",
        },
      },
      required: ["pattern"],
    },
  },
  {
    name: "file_exists",
    group: "Validation",
    description: "Check whether a workspace path exists, and whether it's a file or a directory.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to the workspace root." },
      },
      required: ["path"],
    },
  },
  {
    name: "diff_files",
    group: "Validation",
    description: "Show a unified diff between two text files in the workspace.",
    input_schema: {
      type: "object",
      properties: {
        path_a: { type: "string", description: "First file, relative to the workspace root." },
        path_b: { type: "string", description: "Second file, relative to the workspace root." },
      },
      required: ["path_a", "path_b"],
    },
  },
  {
    name: "run_command",
    group: "Execution",
    description:
      "Run a shell command in the sandboxed workspace. The working directory is pinned " +
      "inside the workspace and the command is killed if it runs longer than the " +
      "configured timeout. A non-zero exit code is returned as normal output, not an error.",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string", description: "The shell command to run." },
        cwd: {
          type: "string",
          description: "Working directory relative to the workspace root. Defaults to the workspace root.",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "run_tests",
    group: "Execution",
    description:
      "Run the project's configured test command. Fails with a clear message if none " +
      "is configured and no explicit command is given.",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Override the configured test command." },
        cwd: {
          type: "string",
          description: "Working directory relative to the workspace root. Defaults to the workspace root.",
        },
      },
      required: [],
    },
  },
  {
    name: "run_lint",
    group: "Execution",
    description:
      "Run the project's configured lint command. Fails with a clear message if none " +
      "is configured and no explicit command is given.",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Override the configured lint command." },
        cwd: {
          type: "string",
          description: "Working directory relative to the workspace root. Defaults to the workspace root.",
        },
      },
      required: [],
    },
  },
  {
    name: "run_build",
    group: "Execution",
    description:
      "Run the project's configured build command. Fails with a clear message if none " +
      "is configured and no explicit command is given.",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Override the configured build command." },
        cwd: {
          type: "string",
          description: "Working directory relative to the workspace root. Defaults to the workspace root.",
        },
      },
      required: [],
    },
  },
  {
    name: "git_status",
    group: "Version Control",
    description: "Show the working tree status (git status --porcelain -b).",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Repository directory relative to the workspace root. Defaults to the workspace root.",
        },
      },
      required: [],
    },
  },
  {
    name: "git_diff",
    group: "Version Control",
    description: "Show unstaged changes, or staged changes if staged is true.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Repository directory relative to the workspace root. Defaults to the workspace root.",
        },
        staged: {
          type: "boolean",
          description: "Show staged (git diff --staged) instead of unstaged changes.",
        },
      },
      required: [],
    },
  },
  {
    name: "git_log",
    group: "Version Control",
    description: "Show recent commit history, one line per commit.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Repository directory relative to the workspace root. Defaults to the workspace root.",
        },
        max_entries: {
          type: "integer",
          description: "Maximum number of commits to show. Defaults to 20.",
        },
      },
      required: [],
    },
  },
  {
    name: "git_add",
    group: "Version Control",
    description: "Stage specific files or directories for commit.",
    input_schema: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          items: { type: "string" },
          description: "Paths to stage, relative to the workspace root.",
        },
        path: {
          type: "string",
          description: "Repository directory relative to the workspace root. Defaults to the workspace root.",
        },
      },
      required: ["paths"],
    },
  },
  {
    name: "git_commit",
    group: "Version Control",
    description:
      "Commit whatever is currently staged. Call git_add first to choose what's " +
      "included — this never stages files itself.",
    input_schema: {
      type: "object",
      properties: {
        message: { type: "string", description: "The commit message." },
        path: {
          type: "string",
          description: "Repository directory relative to the workspace root. Defaults to the workspace root.",
        },
      },
      required: ["message"],
    },
  },
  {
    name: "git_branch",
    group: "Version Control",
    description: "List local branches, or create a new one from create. Never switches branches.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Repository directory relative to the workspace root. Defaults to the workspace root.",
        },
        create: {
          type: "string",
          description: "Name of a new branch to create, without switching to it.",
        },
      },
      required: [],
    },
  },
  {
    name: "git_show",
    group: "Version Control",
    description: "Show a specific commit or ref (git show <ref>).",
    input_schema: {
      type: "object",
      properties: {
        ref: { type: "string", description: "Commit hash, branch, tag, or other git ref." },
        path: {
          type: "string",
          description: "Repository directory relative to the workspace root. Defaults to the workspace root.",
        },
      },
      required: ["ref"],
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
