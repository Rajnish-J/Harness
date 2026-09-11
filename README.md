# Harness

A coding-agent harness, built from scratch as a learning project.

Point it at a project, and an agent works on it with real tools — reading and
editing files, running commands, using git, and navigating code by structure
rather than by grep — inside a sandbox, with every tool call streamed to the UI
as a step you can inspect or approve.

**Python owns the harness core** — the agent loop, tool execution, context
assembly, memory, and guardrails. **Next.js owns everything user-facing** —
chat, the project IDE, the workflow canvas, and the registry admin pages. They
talk over a streaming HTTP boundary, and share one Postgres database in which
Drizzle owns all the schema.

## What it does

- **Chat with an agent** that has 43 tools scoped to a sandboxed workspace, in
  three modes: `auto` (it runs tools itself), `manual` (every call waits for
  your approval), and `chat` (no tools at all).
- **Work on projects** — clone a GitHub repo or scaffold a blank one, edit in an
  in-app Monaco IDE, commit, push, and open a PR. Each project gets its own
  sandbox directory and optionally its own container.
- **Compose the turn** — attach a saved agent preset, skills, an explicit tool
  subset, MCP servers, and a model, per conversation.
- **Automatic tool selection** — before each turn a cheap model reads the
  message and picks which of those tools it actually needs, so a large MCP
  surface no longer costs a full schema dump on every call. The choice is a step
  in the chat you can expand, and the agent can pull a held-back tool in
  mid-turn if the pick was too narrow.
- **Memory** that survives a conversation, at project or global scope, editable
  by hand on `/memory`.
- **Workflows** — multi-step agent pipelines on a canvas, executed as a
  LangGraph DAG.
- **MCP servers** — external tool servers over stdio, SSE or HTTP, namespaced
  as `mcp__{server}__{tool}` so they cannot shadow a built-in.

## The tool surface

| Group | Tools |
| --- | --- |
| **File Operations** | `read_file` `write_file` `list_directory` `edit_file` `delete_file` `move_file` `copy_file` `make_directory` `apply_patch` `multi_edit` |
| **Code Intelligence** | `code_outline` `read_symbol` `find_definition` `find_references` `list_imports` `find_importers` |
| **Project Insight** | `project_overview` `list_dependencies` `file_stats` |
| **Validation** | `search_files` `glob_files` `file_exists` `diff_files` |
| **Execution** | `run_command` `run_tests` `run_lint` `run_build` `run_typecheck` `run_format` |
| **Version Control** | `git_status` `git_diff` `git_log` `git_add` `git_commit` `git_branch` `git_show` `git_blame` `git_stash` |
| **Memory / Project** | `remember` `list_project_chats` `read_project_chat` |
| **Web** | `fetch_url` `web_search` — off unless enabled |

Tools live in `backend/app/agent/tools/`, one subpackage per category. Adding
one means writing a `run()` that ends in `**_ignored`, wrapping it in a `Tool`,
and **appending** it to `ALL_TOOLS` — see [Design notes](#design-notes) for why
appending matters. Nothing in the loop, the LLM clients or the API needs to
change; `/tools` and the composer pick it up automatically.

## Running it

Two processes, plus Postgres.

### Backend

```bash
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python -m uvicorn app.main:app --reload --port 8000
```

Nothing in `.env` is required — with no key at all the harness still boots, and
you can add a provider key on the Credentials page instead. A key registered
there wins over `.env`, which is what lets you add a provider without
restarting.

```bash
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-opus-5
```

`DATABASE_URL` is optional too: chat works without it, and the workflow routes
return 503 rather than crashing.

### Frontend

```bash
cd frontend
npm install
cp .env.example .env.local
npm run db:migrate     # Drizzle owns the schema
npm run dev
```

Open http://localhost:3000.

### Tests

```bash
cd backend && python -m pytest      # 607 tests, no network, no API key needed
```

### Try it

> Give me an overview of this project, then show me the outline of the agent
> loop and read just the `_dispatch_tool` function.

You should watch `project_overview → code_outline → read_symbol` stream past as
individual steps. Then ask it to read `../../etc/passwd` — the step turns red,
the agent sees the refusal, and recovers.

## Layout

```
backend/
  app/
    core/config.py       env-driven settings
    core/workspace.py    resolve_safe_path() — the sandbox guardrail
    agent/loop.py        the decide → act → observe generator + base prompt
    agent/prompt.py      per-turn prompt composition (agent, skills, memories)
    agent/exec_context.py  host vs container execution
    agent/llm/           LLMClient protocol + Anthropic, OpenAI, Groq clients
    agent/tools/         base, registry, toolsets + one subpackage per category
    mcp/                 connection manager, tool wrapping, credentials
    api/                 chat (SSE), projects, workflows, memory, mcp, ...
    db/                  hand-written psycopg repos — no ORM, no DDL
    projects/            clone, scaffold, containers, per-project workspaces
    workflow/            LangGraph DAG compiler and runner
  tests/                 51 files
  workspace/             the agent's sandbox — nothing outside it is reachable
frontend/
  app/                   chat, projects, workflows, agents, skills, memory, mcp
  components/            chat/, projects/ (the IDE), workflow/ (the canvas), ui/
  db/schema.ts           Drizzle — the single source of truth for the schema
```

## Design notes

**Why the guardrail is one function.** Every file tool routes through
`resolve_safe_path`, so a sandbox escape has exactly one thing to defeat rather
than thirty. It rejects absolute paths, then `.resolve()`s — which collapses
`..` *and* follows symlinks — and asserts containment. A project-scoped turn
re-anchors `workspace_root` at the project directory rather than relaxing the
check.

**Why tool order is load-bearing.** `ALL_TOOLS` is append-only. The tool list is
serialized into every request, so it forms the cacheable prompt prefix; inserting
a tool shifts everything after it and invalidates that prefix for every live
session. This is why `git_blame` and `git_stash` sit in their own list at the
end rather than inside `GIT_TOOLS`, despite sharing its group.
`tests/test_tool_registry_order.py` pins it.

**Why the code-intelligence tools advertise their own limits.** Python is parsed
with a real AST and those answers are exact; TypeScript and JavaScript are
regex heuristics, and `find_references` is a word-boundary text match in every
language. That is stated in the tool descriptions, in the output itself, and in
the system prompt, because a model that treats an incomplete reference list as
complete will rename a symbol and leave call sites broken.

**Why the multi-change editors are all-or-nothing.** `apply_patch` and
`multi_edit` apply everything in memory and write only once every part has
succeeded, so a failure message can say "nothing was applied" and be believed —
which is what stops a model re-applying the half it thinks got through.

**Why the tool list is chosen by a model, not just by the composer.** The tool
schemas are serialized into every request and resent on every iteration of the
loop, so with a couple of MCP servers attached they dominate the prompt — 67
tools is ~9k tokens of schema *per call*, which on a small-context model crowds
out the conversation before the user's message is read. So one cheap call runs
first, reading the message and a compact catalog (name, group, one sentence)
rather than the schemas, and picks what the task needs. On a four-iteration turn
over 67 tools that is ~36.6k tokens of schema down to ~6.6k, catalog included.

Three properties make that trade safe, and `tests/test_tool_router.py` pins each
one. It can only ever *shrink* the set the composer and `/tools` already
allowed, so a hallucinated name is dropped rather than granted. It preserves
`ALL_TOOLS` order, for the same reason the registry is append-only. And it fails
open: a timeout, an unparseable reply or a missing key offers the whole toolset
rather than none, because unlike the MCP fallback in `merge_toolsets` — where
widening on a network error would be a real escalation — the failure here is
"this turn costs what it used to". A pick that turns out too narrow is not a
dead end either: `request_tools` lets the model pull a held-back tool in
mid-turn, and the loop rebuilds the schemas around it.

**Why a provider-agnostic `LLMClient` isn't a normalized message format.**
Anthropic batches every `tool_result` into one user message; OpenAI wants one
`tool` message per call. Rather than invent a common history format, each client
owns its own on-the-wire shape and the loop only sees `LLMTurn` /
`ToolCallRequest` / `ToolResult`. That keeps `loop.py` free of
`if provider == ...`. The cost: history is provider-specific, so sessions are
tagged with the provider that created them.

**Why SSE and not WebSocket.** Streaming is one-directional — the server
narrates, the client watches. Because the request needs a JSON body, the
browser's GET-only `EventSource` is out, so the client POSTs with `fetch` and
parses `data:` frames by hand.

**Tool failures are results, not exceptions.** A blocked path, a missing file,
malformed arguments, or an unknown tool name all come back as `is_error: true`
results the model reads and recovers from. Only the harness itself failing ends
the turn.

**Why Drizzle owns the schema and Python has no ORM.** One side has to own DDL
or migrations race. Python queries the same database through hand-written
psycopg repos, and `tests/test_no_ddl.py` enforces that it never issues DDL.

## Known limitations

- **No auth.** The boundary is whoever can reach the port. This is a localhost
  tool, and that stops being true the moment it is exposed to a network.
- **`run_command` on the host path is unrestricted shell** as the server user
  when no project container is attached. The container is the stronger boundary.
- **Web access is check-then-connect**, so it is theoretically vulnerable to DNS
  rebinding. See the module docstring in `agent/tools/web/_fetch.py`.
- **No stream reconnect.** If SSE drops mid-loop, re-send the message.
- **The tool router adds a call per turn.** It only runs once the toolset is
  bigger than `TOOL_ROUTER_THRESHOLD` (25), and it fails open, so a routing
  outage costs tokens rather than the turn — but a wrong pick costs the model a
  `request_tools` round trip. Switch it off in the composer for turns where you
  already know the toolset.
- Milestone-level gaps — container runtime, GitHub push/PR — are tracked in
  [docs/PENDING.md](docs/PENDING.md), which is the authoritative status doc.
