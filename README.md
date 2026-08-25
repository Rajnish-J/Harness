# Harness

An AI coding-agent harness, built from scratch as a learning project.

**Python owns the harness core** — the agent loop, tool execution, context
assembly, memory, and guardrails. **Next.js owns everything user-facing** —
chat, and eventually a repo browser, memory/skills admin, and a workflow
canvas. They talk over a streaming HTTP boundary; the Python side is kept as
stateless-per-call as possible.

## Milestone 1 (current)

A working `decide → act → observe → repeat` loop with one tool surface
(sandboxed file read/write/list), streamed over SSE, in a chat UI that renders
every intermediate step.

```
you ──▶ Next.js chat ──POST /api/chat──▶ FastAPI ──▶ agent loop ──▶ LLM
                     ◀──── SSE events ────────────────────┤
                                                          └──▶ file tools
                                                               (sandboxed)
```

Not yet built: memory persistence, a database, auth, the workflow canvas, MCP.

## Running it

Two processes. Backend first.

### Backend

```bash
cd backend
python -m venv venv && source venv/bin/activate   # if you don't have one
pip install -r requirements.txt
cp .env.example .env        # then add an API key
uvicorn main:app --reload --port 8000
```

Set **either** provider in `.env`:

```bash
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-opus-5
```

```bash
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o        # no default — you must name one
```

The server refuses to start if the selected provider's credentials are missing,
rather than failing on the first chat request.

### Frontend

```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000.

### Try it

> list the files, then create notes.md with three bullet points about agent
> loops, and read it back

You should watch `list_directory → write_file → read_file` stream past as
individual steps before the final answer, and find the file in
`backend/workspace/`. Click any step to expand its full result.

Then try asking it to read `../../etc/passwd` — the step turns red, the agent
sees the refusal, and recovers.

## Layout

```
backend/
  app/
    core/config.py       env-driven settings; validates provider credentials
    core/workspace.py    resolve_safe_path() — the sandbox guardrail
    agent/loop.py        the decide → act → observe generator
    agent/session.py     in-memory session store
    agent/llm/           LLMClient protocol + Anthropic and OpenAI clients
    agent/tools/         file tools + registry
    api/chat.py          POST /api/chat (SSE), /api/session/reset, /api/config
    models/events.py     the SSE event schema
  workspace/             the agent's sandbox — nothing outside it is reachable
frontend/
  app/page.tsx           renders <ChatWindow/>
  components/chat/       ChatWindow, MessageList, MessageBubble,
                         AgentStepIndicator, MessageInput
  lib/api.ts             POST + hand-rolled SSE frame parser
```

## Design notes

**Why a provider-agnostic `LLMClient` isn't a normalized message format.**
Anthropic batches every `tool_result` into one user message; OpenAI wants one
`tool` message per call. Rather than invent a common history format and
translate both ways, each client owns its own on-the-wire shape and the loop
only ever sees `LLMTurn` / `ToolCallRequest` / `ToolResult`. That's what keeps
`loop.py` free of `if provider == ...`. The cost: a session's history is
provider-specific, so sessions are tagged with the provider that created them
and refuse to be replayed through the other.

**Why SSE and not WebSocket.** Streaming is one-directional here — the server
narrates, the client watches. A WebSocket would add connection lifecycle and
reconnect handling for capability this milestone doesn't use. Because the
request needs a JSON body, the browser's GET-only `EventSource` is out, so the
client POSTs with `fetch` and parses `data:` frames by hand (~15 lines).

**Why the guardrail is one function.** Every file tool routes through
`resolve_safe_path`, so a sandbox escape has exactly one thing to defeat rather
than three. It rejects absolute paths, then `.resolve()`s — which collapses
`..` *and* follows symlinks — and asserts containment, so a symlink pointing
out of the sandbox is caught too.

**Tool failures are results, not exceptions.** A blocked path, a missing file,
malformed tool arguments, or an unknown tool name all come back as
`is_error: true` tool results the model reads and recovers from. Only the
harness itself failing ends the turn.

## Known limitations

- **No stream reconnect.** If SSE drops mid-loop, re-send the message.
- **No transcript persistence.** Refreshing clears the visible messages; the
  server-side session survives under the same id in `localStorage`, but there's
  no history endpoint to repaint from.
- **Sessions die with the process.** Deliberately — it's the tell that nothing
  is secretly writing to disk. Durable state arrives with the Next.js/Postgres
  milestone.
