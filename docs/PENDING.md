# Pending work

What is **not** finished across the five milestones of the projects feature
(credentials → projects → containers → IDE → GitHub actions), plus the
cross-session memory feature that landed after them.

Hand-maintained, unlike [`BRANCHES.md`](./BRANCHES.md) which is generated. Last
reviewed 2026-09-02, against the code on `feat/cross-session-memory`.

Two categories are kept apart on purpose, because they carry very different risk:

- **Never executed** — the code exists and its failure paths are tested, but the
  success path has never once run. This is where surprises live.
- **Not built** — a known gap, behaving correctly by omission.

---

## Status at a glance

| Milestone | State | The honest caveat |
| --- | --- | --- |
| M1 Credentials | Working end to end | GitHub only; other providers store but do not validate |
| M2 Projects: clone & list | Working end to end | Clone only — no pull, no re-sync |
| M3 Docker runtime | **Never executed** | Docker Desktop is installed but its engine won't start — WSL2's "Virtual Machine Platform" feature isn't enabled yet |
| M4 Project IDE | Working end to end | Read/edit only — no create, delete or rename |
| M5 GitHub actions | **Never executed** | No push, PR or merge has run against a real repo — blocked on a GitHub credential being added through the app |
| Memory (cross-session) | Working, but no model has used it | Read and write paths verified against real Postgres; no LLM has ever *chosen* to call `remember` — this environment has no API key |

---

## Never executed — verify these first

### Docker container lifecycle (M3)

Still never executed. Docker Desktop is now installed, but its engine cannot
start yet, for a more specific reason than "Docker isn't installed": **WSL2
itself isn't usable on this machine**. `docker info`/`docker ps` return a 500
from `dockerDesktopLinuxEngine`, and `wsl --status` names the actual cause —
the **"Virtual Machine Platform" Windows optional feature is not enabled**
(distinct from firmware-level virtualization, which `systeminfo` confirms
already has a hypervisor present). The fix, in an **elevated** PowerShell:

```
wsl.exe --install --no-distribution
```

then a restart. This is a real first-failure discovered by actually trying to
verify M3 on Windows, ahead of the two failures anticipated below — worth
checking before either of them.

- `ensure_container()` — create, image pull, start
- The bind mount of a Windows host path into a Linux container
- Host-port read-back after start
- A real `docker exec` through `DockerExec`

`DockerExec` is tested against a fake client, which pins path translation and
failure behaviour but says nothing about whether Docker Desktop will mount
`C:\Users\...`. **The two most likely first failures once the engine is up**,
both of which surface as explicit messages rather than crashes:

1. **Drive sharing** — the drive must be added under Docker Desktop →
   Settings → Resources → File sharing.
2. **Named pipe** — `docker.from_env()` should find it; if not, enable *Expose
   daemon on tcp://localhost:2375* and set `DOCKER_HOST`.

Everything else keeps working without a daemon: files come off the host mount,
so the tree, the editor and git are unaffected, and commands fall back to the
host with a stated reason.

### A model actually choosing to call `remember` (Memory)

The memory feature's own machinery is exercised: `remember()` was called
directly against the real database, a second session read the row back, and
the composed `<memories>` block was inspected — see the Memory section below.
What has *never* happened is the part that matters in practice: an LLM
reading the tool description and deciding, unprompted, that something is
worth remembering. This environment's `ANTHROPIC_API_KEY` is a placeholder,
so no turn has ever reached a model.

The two likely first surprises, both cheap to check once a key exists:

1. **It is called too often** — the model remembers things that are merely
   true of the current task. The tool description pushes against this
   ("Do not use it for facts already obvious from the code"), but only a real
   run shows whether that is enough.
2. **It is never called at all** — the description sits at the end of a long
   tool list and gets ignored. If so, the lever is the system prompt in
   `app/agent/loop.py`, which currently says nothing about memory.

### The GitHub write path (M5)

Still never executed against a real repository, pending a GitHub credential
being added through the app's own Credentials page (`POST /api/credentials`
with a PAT with `repo` scope) — deliberately not something this harness
extracts from a locally-authenticated `gh` CLI session on the operator's
behalf, so a person has to do that step themselves.

While reviewing this path ahead of that first real run, one real bug was
found and fixed: in `commit()` (`backend/app/api/project_git.py`), if
`commit_all()` succeeded but resolving the project's GitHub token then failed
(no credential linked, disabled, or a decrypt error), the endpoint raised a
bare error with no indication the commit had already landed locally —
inconsistent with the push-failure branch a few lines below, which already
says "Committed locally, but the push failed." Fixed to say the equivalent
for a token failure. No route-level test exists for this yet (nothing in this
module has any — see Cross-cutting below); the fix was verified by reading,
not by a new test.

Beyond that, `git_ops.push()` and the git-subprocess plumbing it shares with
`clone()` are lower-risk than they look: `clone()` has already run
successfully against a real repository in this environment (the `HW` test
project), which exercises the same `_git()`/`run_subprocess()` machinery
`push()` uses — the genuinely untested part is narrower than "all of git_ops,"
it's really just the GitHub REST calls in `app/integrations/github.py`
(`create_pull_request`, `merge_pull_request`) and the push auth path.

---

## M1 — Credentials

- **Only GitHub tokens are validated.** `azure_devops`, `gitlab` and `generic`
  are storable and encrypted, but `POST /api/credentials/{id}/test` returns
  "not implemented yet" for them. See `backend/app/api/credentials.py`.
- **No key rotation path.** Changing `CREDENTIALS_ENCRYPTION_KEY` makes every
  stored token undecryptable, and the only recovery is deleting and re-adding
  them. The `v1.` prefix in the ciphertext format leaves room for a re-encrypt
  migration; nothing implements one.

---

## M2 — Projects

- **Clone only — no pull, fetch, or re-clone.** `git_ops.py` has `clone`,
  `create_branch`, `commit_all`, `push`, `list_branches`, `current_branch` and
  `working_tree_dirty`. There is no way to update a checkout once it exists, so
  a repo that moves on upstream goes stale silently.
- **No branch switching.** `create_branch` makes a new one; checking out an
  existing branch is not exposed anywhere.
- **The repo picker only ever loads page 1.** `projectsApi.listRemoteRepos`
  accepts a `page`, but `AddProjectDialog` never passes one, so an account with
  more than 50 repositories cannot reach the rest from the UI.
- **Deleting a project now reclaims disk.** Archiving is still soft
  (`archivedAt`), which is correct, but the Delete button no longer stops
  there: it archives the row, then calls `POST /api/projects/{id}/purge`
  (`backend/app/api/projects.py`), which removes the container, clears
  `project_files`, and deletes the checkout via `remove_project_workspace()`.
  The two calls are deliberately in that order and the second is allowed to
  fail — a missing Docker daemon or a locked file degrades to "the row is gone,
  the files are still there", which is where this used to stop unconditionally.
  Verified end to end on a throwaway project with Docker not running.
- **Project settings now exist, but only the three patchable fields.**
  `/projects` has Edit and Delete on every project, in both the card grid and
  the new list view (`components/projects/EditProjectDialog.tsx`,
  `DeleteProjectDialog.tsx`). Edit covers exactly what `PATCH
  /api/projects/{id}` accepts — name, linked credential, default branch.
  `slug` is still frozen at creation (it is the unique key, so the name and the
  URL can drift apart), `description` is still not patchable, and an
  already-connected project still cannot be re-pointed at a different remote or
  disconnected — `connectProjectToGithub` guards on `isNull(repoUrl)`.
- **The list view is the only table in the app.** `/projects` can render as a
  TanStack Table v9 data table with sorting, a name filter, column visibility,
  selection and pagination. Its three helper components are typed against one
  concrete features object (`components/projects/table/projects-table-features.ts`)
  rather than being generic over `TFeatures` — v9 decides which methods exist on
  a `Column`/`Table` from what the table registered, so an unconstrained
  `TFeatures` does not type-check. A second table would declare its own features
  object; generalising the helpers before then is not possible.
- **The layout choice is per-browser, not per-user.** Grid vs list is held in
  `localStorage` via `hooks/use-stored-preference.ts`. There is no user, so
  there is nowhere else to put it.
- **Blob sha tracks the git INDEX, not the working tree.** `git ls-files -s`
  reports the staged sha, so an unstaged edit does not change it. Fine for
  rendering a tree; do not build finer change detection on it without checking
  this first.

---

## M3 — Containers

Beyond "never executed" above:

- **Image is now detected from the repo's manifest file, not hardcoded.**
  `app/projects/image_detect.py` checks the repo root for `package.json`,
  `pyproject.toml`/`requirements.txt`/`Pipfile`, `go.mod`, `Cargo.toml`,
  `pom.xml`/`build.gradle(.kts)`, `Gemfile`, or `composer.json` and picks a
  matching image, falling back to `Settings.default_project_image`
  (`node:22-bookworm-slim`) when nothing matches. Root-level only — no
  recursive scan, no per-project override UI, and a repo with more than one
  manifest just takes whichever rule is listed first.
- **Each clone also gets a `.devcontainer/devcontainer.json`.**
  `app/projects/devcontainer.py::ensure_devcontainer()` writes one (using the
  same detected image) right after a successful clone or `init`, so the
  checkout can be opened directly in VS Code's own Dev Containers extension.
  It never overwrites a repo that already ships its own devcontainer config,
  and it is written but **not** `git add`ed for a cloned project — it only
  becomes visible in the in-app tree once the user's own next commit picks it
  up. This is scaffolding only: nothing in the app attaches VS Code to the
  container the badge starts, and the two containers are unrelated.
- **The image pull blocks.** First use of an image can take minutes inside
  `ensure_container()`, with no progress streamed to the UI. The clone endpoint
  already shows how to stream this.
- **Containers are never auto-started.** Opening a project leaves it stopped
  until the badge's play button is pressed.
- **Nothing reaps stopped containers.** They accumulate until removed by hand.

---

## M4 — Project IDE

- **No file creation, deletion or renaming.** The API is `GET /tree`,
  `GET /file`, `POST /file`. `POST` will create a file at a new path (it
  `mkdir -p`s the parent), but nothing in the UI offers it, and there is no
  delete or rename at all. The agent's tools remain the only way.
- **One file at a time — no tabs.** Selecting a file replaces the editor.
- **Binary and oversized files cannot be opened.** Binary files are listed and
  greyed; anything over `max_file_bytes` (200 KB) is refused with a 413 rather
  than truncated, deliberately — half a file in an editor that can save is a
  good way to lose the other half.
- **No search across files.** The tree is the only way to find anything.
- **Every save re-indexes the whole project.** Correct, because a save can
  change what git tracks, and `git ls-files` is fast — but it is O(repo) per
  save and will be felt on a large repository.
- **`clear_session()` is dead code.** `backend/app/db/project_chat_repo.py`
  defines it; nothing calls it. There is no "new chat" button in the project
  panel, so a project conversation cannot be reset, and the persisted rows
  outlive any reset the operator attempts elsewhere.
- **Chat history is capped at 500 messages with no pagination.** Older lines are
  simply not loaded.
- **The preset is not persisted per project.** Attaching an agent or skills in a
  project's chat is lost on reload; only the transcript survives.

---

## M5 — GitHub actions

Beyond "never executed" above:

- **Merge method is fixed to `merge`.** The backend accepts `squash` and
  `rebase`; the UI never offers them.
- **No pull-request list.** The Merge button picks the PR matching the current
  branch, else the first open one. There is no way to see or choose among
  several.
- **No conflict handling.** A non-fast-forward push or a conflicted merge
  returns GitHub's message and stops; resolution happens on github.com.
- **Commit is all-or-nothing.** `commit_all` stages the entire tree; there is no
  partial staging or hunk selection.

---

## Memory (cross-session)

Two tiers in one table (`memory_entries`): a row with `project_id is null`
reaches every conversation, a project-scoped row reaches only that project's.
`_prepare_turn` re-reads both on every request and composes them into the
system prompt, so a memory written in one session lands in another session's
next turn with nothing typed into it. The agent writes via the `remember`
tool; a human writes via `/memory`.

Two pages: `/memory` edits them, `/memory-insights` explains them — grouping
by project and by originating conversation, and rendering the exact
`<memories>` block a turn in a given scope receives (composed through the real
`compose_system_prompt`, so the preview cannot drift from the prompt).

- **No session-level compaction.** This feature is about memory *between*
  sessions; nothing shrinks a single session's own history, which is still
  sent to the provider in full and unbounded every call
  (`app/agent/loop.py`). A long conversation still ends in a provider error
  rather than a summarisation.
- **No deduplication.** Re-using a slug edits that memory, which is the
  intended way to revise one — but two near-identical memories under
  different slugs both persist, and nothing notices. Curating them is manual,
  through `/memory`.
- **Nothing prunes or ages memory out.** Rows live until archived by hand. A
  memory that was true in April is still in the prompt in September.
- **Archived rows are only recoverable in SQL.** Delete soft-deletes
  (`archived_at`), but there is no archived view and no un-archive in the UI —
  and `/memory-insights` does not close this: `archived_at` is never selected
  by the repo layer at all, so putting it on screen means touching `_COLUMNS`,
  `MemoryRow`, `_row`, `MemoryOut` and the TS type.
- **The overview is a full scan.** `GET /api/memory/overview` returns every
  active memory in every scope with no pagination, on the theory that memory
  small enough to fit in a prompt is small enough to list. A harness that
  outgrows that gets a slow page before it gets a wrong one.
- **Session titles are derived, and can go missing.** `/memory-insights`
  groups by the conversation a memory came from, resolved through
  `list_sessions_by_ids`. `clear_session` hard-deletes chat rows while the
  memory keeps the id, so those land under "Conversation no longer exists" —
  correct, but it means provenance degrades over time.
- **The global chat has no narrower tier.** With no project open, a
  `scope="project"` remember becomes a global row, because global vs project
  are the only two scopes. Something scratch-only said in the top-level chat
  can therefore reach every project.
- **The prompt budget is shared.** Memories are truncated by the same
  `max_system_prompt_chars` (120,000) ceiling as skills, and they are composed
  last — so a large enough skill set could, in principle, truncate memory
  away. Nothing warns when that happens.
- **Workflow nodes cannot write memory.** `remember` is in `ALL_TOOLS`, so a
  workflow node with no tool allowlist advertises it — but
  `app/workflow/nodes/agent_node.py` calls `run_agent_loop` without a `pool`,
  so calling it there returns "not available in this context" and the model
  moves on. Deciding what scope a workflow's memory would even have (runs are
  not project-scoped) is the open question, not the plumbing.
- **Mock mode covers memory, but not the projects it groups by.**
  `NEXT_PUBLIC_MOCK_MEMORY` (and `MOCK_ALL`) serve both memory pages from
  `frontend/lib/mock/memory.ts`, with create/edit/delete persisting in the
  tab's `mockStore()` until reload. `projectsApi` still has no mock branch, so
  `/memory-insights` seeds its project *names* from the same fixture file —
  meaning in mock mode the project list shown there is the fixtures', not
  Postgres's, even if Postgres is up.
- **The mock `<memories>` block is hand-kept in step with `prompt.py`.**
  `renderMemoryBlock` in the fixtures reimplements `_memory_block`'s shape and
  its `(kind, slug)` ordering. The real preview endpoint composes through
  `compose_system_prompt` and cannot drift; the mock one can, and only a
  reader would notice.

## Cross-cutting

- **Single user, no auth.** CORS runs with `allow_credentials=False` and there
  is no session or identity anywhere. Every project and credential belongs to
  whoever opened the browser. This is a deliberate property of a localhost
  harness, not an oversight — but it is what makes the plaintext-adjacent parts
  (an unencrypted `mcp_servers.env`, a decryptable PAT) acceptable, and it stops
  being true the moment this is exposed to a network.
- **The README does not mention any of this.** It still describes Milestone 1 of
  the original harness — no projects, no credentials, no containers.
- **No integration tests for Docker or GitHub.** Both need real credentials and
  a real daemon. The pure logic is covered (296 backend tests); the I/O is not.
- **Every `NEXT_PUBLIC_MOCK_*` flag is currently `true` in `frontend/.env`,**
  so the whole app serves fixtures and the header shows "All mock". Two things
  that costs you: `MOCK_TOOLS` is the one flag `MOCK_ALL` deliberately does
  *not* imply, so turning it on really does stop `/tools` and the composer's
  tool picker from reflecting the live Python registry; and the credentials
  and projects pages have no mock branch at all, so they still hit Postgres
  and will error while everything around them renders. Flip them back in
  `frontend/.env` — and restart `next dev`, since these are inlined at build
  time.

---

## Suggested order

1. **Enable "Virtual Machine Platform" (`wsl.exe --install --no-distribution`,
   elevated) and restart, then exercise M3.** Docker Desktop is installed but
   its engine can't start without this. Still the largest block of unverified
   code, and everything about the container path is guesswork until one
   actually starts.
2. **Add a GitHub credential through the app's own Credentials page, then push
   a branch and open a PR through the UI.** Second-largest block of unverified
   code, and quick to check once a credential exists.
3. **Add pull/fetch** (M2). Without it a project is a one-time snapshot, which
   undercuts the point of pointing the agent at a live repository.
4. **File create/delete/rename** (M4). The most obviously missing IDE verb.

Per-project container image selection (M3) and a `.devcontainer/devcontainer.json`
scaffold on clone/init are now done — see M3 above.
