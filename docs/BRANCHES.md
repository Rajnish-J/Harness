# Branch Ledger

<!-- GENERATED FILE — do not edit by hand.
     Produced by scripts/generate_branch_log.py, run automatically by
     .github/workflows/branch-ledger.yml after every PR merges into main.
     To correct a purpose, edit docs/branch-notes.json instead. -->

Every branch in [`Rajnish-J/Harness`](https://github.com/Rajnish-J/Harness) — what it was for, when it
started, and when it landed. The base branch is `main`.

_Last updated 2026-08-26 (UTC) · 4 merged · 0 open · 0 closed unmerged · 0 without a PR_

## Merged branches

| Branch | PR | Purpose | Created | Merged | Into | Changes |
| --- | --- | --- | --- | --- | --- | --- |
| `feat/tool-modes-model-picker-and-theming` | [#4](https://github.com/Rajnish-J/Harness/pull/4) | Adds three things the chat composer on main cannot express today: a manual tool mode that holds every tool call for a human verdict before it runs, a model pic… | 2026-08-26 | 2026-08-26 | `main` | 71 files, +3530 / −550 |
| `feat/agent-registries-and-mcp-chat` | [#3](https://github.com/Rajnish-J/Harness/pull/3) | Adds the registry layer the harness was missing: agents, skills and MCP servers become first-class stored objects with CRUD APIs and management pages, MCP serv… | 2026-08-26 | 2026-08-26 | `main` | 117 files, +12489 / −459 |
| `feat/workflow-orchestration` | [#2](https://github.com/Rajnish-J/Harness/pull/2) | Builds out the whole Harness product on top of the scaffold that landed in #1: a from-scratch agent harness core in Python, a streaming chat UI, and a LangGrap… | 2026-08-25 | 2026-08-25 | `main` | 100 files, +14017 / −4002 |
| `scaffold` | [#1](https://github.com/Rajnish-J/Harness/pull/1) | Stands up the project skeleton: a Next.js 16 frontend, a minimal FastAPI backend, and the repo's commit skill definition. main was still at the bare initial co… | 2026-08-25 | 2026-08-25 | `main` | 23 files, +7289 / −0 |

## Open pull requests

_None open._

## Branches without a pull request

_None — every branch on the remote has a pull request._

---

## Details

### `feat/tool-modes-model-picker-and-theming` → `main` ([#4](https://github.com/Rajnish-J/Harness/pull/4))

**Merged** 2026-08-26 · created 2026-08-26 · by @Rajnish-J · 13 commits · 71 files, +3530 / −550 · branch still on the remote

**feat: add tool modes, a model picker and a theme toggle**

Adds three things the chat composer on main cannot express today: a manual tool mode that holds every tool call for a human verdict before it runs, a model picker backed by a real catalog, and an app-wide light/dark theme toggle. Along the way the tool surface gains a grouping concept, and the registry pages move from a row list to a shared card grid.

### `feat/agent-registries-and-mcp-chat` → `main` ([#3](https://github.com/Rajnish-J/Harness/pull/3))

**Merged** 2026-08-26 · created 2026-08-26 · by @Rajnish-J · 23 commits · 117 files, +12489 / −459 · branch still on the remote

**feat: add agent, skill and MCP registries and wire MCP into chat**

Adds the registry layer the harness was missing: agents, skills and MCP servers become first-class stored objects with CRUD APIs and management pages, MCP servers are actually connected to and their tools exposed to the agent loop, and the frontend is rebuilt around a persistent app shell. main currently has the chat surface and the workflow canvas but no way to configure what an agent is.

### `feat/workflow-orchestration` → `main` ([#2](https://github.com/Rajnish-J/Harness/pull/2))

**Merged** 2026-08-25 · created 2026-08-25 · by @Rajnish-J · 26 commits · 100 files, +14017 / −4002 · branch still on the remote

**feat: add agent harness core and workflow orchestration canvas**

Builds out the whole Harness product on top of the scaffold that landed in #1: a from-scratch agent harness core in Python, a streaming chat UI, and a LangGraph-backed workflow orchestration layer with a drag-and-drop canvas. main currently has only the Next.js/FastAPI skeleton, so this is the first PR with working functionality.

### `scaffold` → `main` ([#1](https://github.com/Rajnish-J/Harness/pull/1))

**Merged** 2026-08-25 · created 2026-08-25 · by @Rajnish-J · 6 commits · 23 files, +7289 / −0 · branch still on the remote

**feat: scaffold Next.js frontend and FastAPI backend**

Stands up the project skeleton: a Next.js 16 frontend, a minimal FastAPI backend, and the repo's commit skill definition. main was still at the bare initial commit; this brings the scaffold onto it.

---

## How this file is maintained

This ledger is generated, not written. `.github/workflows/branch-ledger.yml`
runs `scripts/generate_branch_log.py` every time a pull request merges into
`main` and commits the result back to `main`. Hand edits are
overwritten on the next merge.

Each branch's purpose comes from its pull request — the title and the first
paragraph of the description — so a well-written PR body produces a good entry
here for free. To override or add to what is extracted, edit
`docs/branch-notes.json`:

```json
{
  "some-branch": {
    "purpose": "One line replacing the auto-extracted summary.",
    "notes": "Optional extra prose, shown only in the Details section."
  }
}
```

To regenerate locally (requires an authenticated `gh`):

```bash
python scripts/generate_branch_log.py
```

`--check` verifies the committed file is current without writing, exiting 1 if
it is stale.
