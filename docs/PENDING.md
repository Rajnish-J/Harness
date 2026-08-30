# Pending work

What is **not** finished across the five milestones of the projects feature
(credentials → projects → containers → IDE → GitHub actions).

Hand-maintained, unlike [`BRANCHES.md`](./BRANCHES.md) which is generated. Last
reviewed 2026-08-29, against the code on `feat/project-integration-vs-code`.

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
| M3 Docker runtime | **Never executed** | Docker is not installed on this machine |
| M4 Project IDE | Working end to end | Read/edit only — no create, delete or rename |
| M5 GitHub actions | **Never executed** | No push, PR or merge has run against a real repo |

---

## Never executed — verify these first

### Docker container lifecycle (M3)

Docker is not installed here (no CLI, no `\\.\pipe\docker_engine`, no WSL
distro), so none of this has run:

- `ensure_container()` — create, image pull, start
- The bind mount of a Windows host path into a Linux container
- Host-port read-back after start
- A real `docker exec` through `DockerExec`

`DockerExec` is tested against a fake client, which pins path translation and
failure behaviour but says nothing about whether Docker Desktop will mount
`C:\Users\...`. **The two most likely first failures**, both of which surface as
explicit messages rather than crashes:

1. **Drive sharing** — the drive must be added under Docker Desktop →
   Settings → Resources → File sharing.
2. **Named pipe** — `docker.from_env()` should find it; if not, enable *Expose
   daemon on tcp://localhost:2375* and set `DOCKER_HOST`.

Everything else keeps working without a daemon: files come off the host mount,
so the tree, the editor and git are unaffected, and commands fall back to the
host with a stated reason.

### The GitHub write path (M5)

`push`, `create_pull_request` and `merge_pull_request` have never been called
against a real repository. Their error branches are tested; the success branches
are not. The first real push will be the first execution of that code.

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
- **Archiving does not reclaim disk.** Deleting a project is soft
  (`archivedAt`), which is correct, but the checkout stays in
  `backend/workspace/projects/<id>/` forever. Nothing calls
  `remove_project_workspace()` outside the failed-clone path.
- **No project settings UI.** `updateProject` and `archiveProject` are wired
  through `frontend/app/api/projects/[id]/route.ts`, but no page calls them —
  a project cannot be renamed, re-linked to a different credential, or deleted
  from the interface.
- **Blob sha tracks the git INDEX, not the working tree.** `git ls-files -s`
  reports the staged sha, so an unstaged edit does not change it. Fine for
  rendering a tree; do not build finer change detection on it without checking
  this first.

---

## M3 — Containers

Beyond "never executed" above:

- **One image for every project.** `Settings.default_project_image` is
  `node:22-bookworm-slim` for everything. `project_containers.image` stores what
  was used, but there is no per-project override and no UI for one — a Python
  repo gets a Node image. Detecting an image from the repo's manifest files is
  the obvious follow-up.
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
  a real daemon. The pure logic is covered (235 backend tests); the I/O is not.
- **`NEXT_PUBLIC_MOCK_ALL=true` is set in `frontend/.env`,** and the credentials
  and projects pages deliberately have no mock branch — they always hit
  Postgres. Worth knowing when the rest of the app is showing fixtures.

---

## Suggested order

1. **Install Docker Desktop and exercise M3.** It is the largest block of
   unverified code, and everything about the container path is guesswork until
   one actually starts.
2. **Push a branch and open a PR through the UI.** Second-largest block of
   unverified code, and quick to check.
3. **Add pull/fetch** (M2). Without it a project is a one-time snapshot, which
   undercuts the point of pointing the agent at a live repository.
4. **File create/delete/rename** (M4). The most obviously missing IDE verb.
5. **Per-project container image** (M3). One image for every language is the
   assumption most likely to annoy in practice.
