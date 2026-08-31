---
name: prepare-pr
description: Gather a branch's full diff against main, verify it in a throwaway git worktree (install, lint, build, typecheck, backend tests), compose a detailed PR title and body naming the actual files in every area, push the branch, and open a pull request with gh pr create — then stop without merging. Use when a feature branch is finished and you want it reviewed on GitHub.
---

# Pull request preparation workflow

Take a finished branch, prove it actually builds and tests green in isolation, describe honestly what it contains, and open a pull request against `main` for human review.

**The three rules that override everything else in this file:**

1. **Never push until the author has granted permission, in this conversation.**
2. **Never open a PR when a verification check failed.** A red check is the answer; report it and stop.
3. **Never merge.** Creating the PR and printing its URL is the end of the job. The author reviews and squash-merges in the GitHub UI.

## Project commands

| Purpose       | Command                 | Note                                              |
| ------------- | ----------------------- | ------------------------------------------------- |
| Install       | `npm ci`                | in `frontend/`; lockfileVersion 3                 |
| Lint          | `npm run lint`          | `eslint`, flat config, no path argument           |
| Build         | `npm run build`         | `next build`                                      |
| Typecheck     | `npx tsc --noEmit`      | **no `typecheck` script exists** — run it directly |
| Backend tests | `python -m pytest -q`   | **cwd must be `backend/`** (relative `testpaths`) |

---

## Phase A — Survey the branch against main

```bash
git fetch origin main --quiet
git rev-parse --abbrev-ref HEAD
git status --porcelain --untracked-files=all      # must be empty, else stop
git log  --oneline      origin/main..HEAD         # the commit list
git diff --numstat      origin/main...HEAD        # scale
git diff --name-status  origin/main...HEAD        # the file list
git diff --dirstat=files,0 origin/main...HEAD     # which areas carry the weight
```

### The two-dot / three-dot rule

This is the single easiest thing to get wrong, and getting it wrong puts fiction in the PR description.

- **`git diff A...B` (three dots)** diffs from `merge-base(A,B)` to `B` — exactly what GitHub renders in the "Files changed" tab. **Always three dots for `git diff`.**
- **`git diff A..B` (two dots)** additionally shows, reversed, anything that landed on `main` after your branch point. It will invent deletions you never made.
- **`git log` reverses the convention.** `git log A..B` is the PR's commit list. **Always two dots for `git log`.**

### Derive the change-scale sentence, never template it

```bash
git diff --name-status origin/main...HEAD | cut -f1 | sort | uniq -c
git diff --numstat origin/main...HEAD | awk '{a+=$1;d+=$2;n++} END {print n, a, d}'
```

Only write *"All additions"* when the `D` and `M` counts are both zero. Otherwise name the mix honestly — "111 new files plus a README rewrite" is the truth; "all additions" would be a verifiable lie in the first line of the PR.

### Detect conflicts without mutating anything

```bash
git merge-base --is-ancestor origin/main HEAD          # exit 0 => fast-forward, no conflict possible
git merge-tree --write-tree --name-only origin/main HEAD   # else exit 1 lists conflicted paths
```

**Never** probe with `git merge --no-commit --no-ff` and `git merge --abort` — that mutates the index and working tree, and a failed `--abort` strands the author mid-merge.

### Stop if the tree is dirty or contains secrets

An unclean tree means the worktree verification would not describe what you are about to push. Stop and say so.

```bash
git diff --name-only origin/main...HEAD | grep -E '(^|/)\.env($|\.)|\.pem$|\.key$|credentials'
git diff origin/main...HEAD | grep -nE '^\+.*(sk-ant-|sk-[A-Za-z0-9]{20}|ghp_|ghu_|AKIA|BEGIN [A-Z ]*PRIVATE KEY)'
```

`backend/.env.example` is tracked and legitimately contains empty `ANTHROPIC_API_KEY=` / `DATABASE_URL=` keys — allow that exact path, block every other match and let the author decide.

---

## Phase B — Verify in an isolated worktree

```bash
MAIN="$(git rev-parse --show-toplevel)"
WT="/workspaces/.harness-pr-verify-$$"            # SIBLING of the repo, never nested inside it
git worktree add --detach "$WT" HEAD
```

**`--detach` is mandatory** — the branch is already checked out in the main tree and `git worktree add` would refuse it. A detached HEAD at the same commit never moves the branch ref.

**Outside the repo root, not nested.** A worktree at `$MAIN/.verify` shows up as untracked junk in `git status`, and `eslint` with no path argument plus `tsc`'s `**/*.ts` include will happily walk into it.

### Frontend

```bash
cd "$WT/frontend"
npm ci
npm run lint
npm run build
npx tsc --noEmit
```

**Build before typecheck, deliberately.** `frontend/tsconfig.json` includes `next-env.d.ts` and `.next/types/**/*.ts`. Both are gitignored and generated by `next build`, so a fresh worktree does not have them. Running `tsc --noEmit` first typechecks a weaker project missing Next's ambient and typed-route declarations.

A `node_modules` symlink from the main tree is a valid fast path **only** when `package.json` and `package-lock.json` are unchanged at `HEAD`:

```bash
git diff --quiet HEAD -- frontend/package.json frontend/package-lock.json \
  && ln -s "$MAIN/frontend/node_modules" "$WT/frontend/node_modules"
```

> **If you symlink, never run `npm ci` or `npm install` in the worktree.** `npm ci` deletes `node_modules` before installing, and pointing that at a symlink into the author's live tree destroys their real install. Report the row as `install — skipped (node_modules symlinked)`; never print a fabricated `npm ci` pass.

### Backend

The repo venv is gitignored and lives outside the worktree. A venv hardcodes its absolute prefix in `pyvenv.cfg` and every `bin/*` shebang, so copying or symlinking it silently keeps resolving to the original. Use the **main tree's interpreter with the worktree's working directory**:

```bash
cd "$WT/backend"
LLM_PROVIDER=anthropic \
ANTHROPIC_API_KEY=ci-placeholder-not-a-real-key \
ANTHROPIC_MODEL=claude-opus-5 \
WORKSPACE_ROOT=./workspace \
CORS_ORIGINS=http://localhost:3000 \
"$MAIN/backend/venv/bin/python" -m pytest -q
```

Two things make this resolve the worktree's code and not the main tree's: `pytest.ini` uses a relative `testpaths = tests`, so **cwd must be `$WT/backend`**; and `tests/__init__.py` exists, so prepend import mode puts `$WT/backend` on `sys.path` and `import app.*` resolves there.

**The env vars are load-bearing, not decoration.** `backend/.env` is gitignored, so it is absent from a fresh worktree and from CI. `app/core/config.py` derives `env_file` from `BACKEND_ROOT`, and its `_require_provider_credentials` validator raises `LLM_PROVIDER=anthropic requires ANTHROPIC_API_KEY to be set.` without them. The key must be a non-empty **placeholder** — never a real one; nothing in the suite makes a network call. Leave `DATABASE_URL` unset on purpose: it is `Optional` by design and no test opens a connection.

**Never** `source`, copy, or echo `backend/.env`.

### Tear down, on every path including failure

```bash
git worktree remove --force "$WT" && git worktree prune
```

`--force` because the run leaves untracked build output. **Never `rm -rf` a worktree path** — that strands an entry in `.git/worktrees/`; if it already happened, `git worktree prune` repairs it.

> **What the worktree run does and does not prove.** It proves the *committed* tree at `HEAD` builds and tests green, isolated from uncommitted work in the author's live tree — which is exactly what the PR contains and what CI will see. It does **not** prove the merge result is green if `main` has moved; only CI's merge-ref run covers that. And a symlinked install does not prove `npm ci` succeeds from the lockfile. State which mode ran; never let the table imply more than was checked.

### Blocking on failure

If any check fails: **do not push, do not open a PR.** Print the failing command and its raw output, tear the worktree down, stop.

A failure may be recorded as pre-existing only if it is *proved* — add a second worktree at `origin/main`, run the identical command, and confirm it reproduces. Then it goes under `## Notes` and the run continues. **Never** edit source, relax a lint rule, or add `@ts-expect-error` to make a check pass. That turns a verification skill into a code-editing skill.

---

## Phase C — Production-readiness sweep

Every run checks the current `HEAD` against the fixed 20-item checklist tracked in [`docs/PRODUCTION_READINESS.md`](../../../docs/PRODUCTION_READINESS.md) and refreshes that file's `Status`/`Evidence` cells. **This phase can never block anything** — it does not gate Phase F/G, and a `Missing` or `N/A` result is never treated like a failed Phase B check.

All checks read the committed tree directly, never the working directory — cheap, deterministic, and independent of the Phase B worktree's lifecycle:

```bash
git grep -niI "<pattern>" HEAD -- <path>     # content search, tracked files only
git ls-files HEAD -- '<glob>'                # existence / path check
```

`git grep`/`git ls-files` against a tree-ish only searches files tracked at that commit, so `node_modules`, `.next`, `venv`, `__pycache__` are excluded for free — no exclude list to maintain, no build step needed.

**Run all 20 items every time — never scope detection to this PR's diff.** Scoping to the diff would let stale rows go unverified indefinitely (a row would only refresh whenever some future PR happens to touch its paths), which breaks the doc's job as a trustworthy source of truth. The diff (already gathered in Phase A) is only used afterward, to phrase the PR body's "Changed this PR" column honestly — never to decide what gets checked.

1. Read `docs/PRODUCTION_READINESS.md`. If absent, this is a first run: the whole file will be proposed as new content at the end of this phase.
2. For each of the 20 items below, run its detection commands and classify `Done` / `Partial` / `Missing` / `N/A (deliberate)` per the legend in the doc's header. An `N/A (deliberate)` classification must cite a specific architectural reason (normally the "single user, no auth" cross-cutting note in `docs/PENDING.md`) — never assert it bare.
3. Diff the freshly computed table against what's currently committed in `docs/PRODUCTION_READINESS.md`.
   - **No deltas:** nothing to write. Report "swept, no change" and move on.
   - **Deltas exist:** hold the proposed new file content in memory — **do not write it to disk yet.** It is shown for approval in Phase E and only ever written in Phase F, gated on the same explicit yes as the push. This keeps the working tree exactly as clean as Phase A found it for the entire "present and stop" window.
4. Never edit `Notes` text a human wrote; only append a short one-line note when a `Status` changes, e.g. `→ Partial→Done in this branch (added ...)`.

### Per-item detection

| # | Item | Detection |
| - | --- | --- |
| 1 | Onboarding | `git ls-files HEAD -- '*onboarding*' '*welcome*'`; `git grep -il "onboarding" HEAD -- frontend/app frontend/components` |
| 2 | Sign up / log in | `git grep -il "signup\|sign-up\|LoginForm\|next-auth\|/api/auth" HEAD -- frontend backend/app` |
| 3 | Email verification | `git grep -il "verify.?email\|email_verified" HEAD -- frontend backend/app` |
| 4 | Password reset | `git grep -il "reset.?password\|forgot.?password" HEAD -- frontend backend/app` |
| 5 | Account deletion | `git grep -n "def purge_project\|DeleteProjectDialog" HEAD -- backend/app/api/projects.py frontend/components/projects`; `git grep -il "class User\b\|users_repo" HEAD -- backend/app/db` (confirms no user-account model exists) |
| 6 | User permissions | `git grep -n "\brole\b" HEAD -- frontend/components backend/app` (exclude `aria-`/`message.role` hits); `git grep -il "RBAC\|is_admin\|@requires_role" HEAD -- backend/app` |
| 7 | Empty states | `git ls-files HEAD -- 'frontend/components/registry/EmptyState.tsx'`; `git grep -l "EmptyState" HEAD -- frontend/components frontend/app` |
| 8 | Loading states | `git ls-files HEAD -- 'frontend/components/ui/skeleton.tsx'`; `git grep -c "Loader2\|isLoading\|isPending" HEAD -- frontend/components frontend/app` |
| 9 | Error states | `git ls-files HEAD -- 'frontend/app/**/error.tsx' 'frontend/app/**/global-error.tsx' 'frontend/app/**/not-found.tsx'` (expect empty); `git ls-files HEAD -- 'frontend/components/ui/toast.tsx' 'frontend/lib/toast.ts'` |
| 10 | Network states | `git grep -il "navigator.onLine\|useOnlineStatus" HEAD -- frontend` (expect none); `git ls-files HEAD -- 'frontend/components/shell/HarnessStatus.tsx'` |
| 11 | Data persistence | `git ls-files HEAD -- 'frontend/db/schema.ts'`; `git ls-files HEAD -- 'frontend/db/migrations/*.sql'`; `git ls-files HEAD -- 'backend/app/db/*_repo.py' 'backend/app/db/pool.py'` |
| 12 | Payment flow | `git grep -il "stripe\|billing\|subscription\|checkout.session" HEAD -- frontend backend/app` |
| 13 | Notifications | `git ls-files HEAD -- 'frontend/components/ui/toast.tsx' 'frontend/lib/toast.ts'`; `git grep -il "sendgrid\|nodemailer\|web-push\|apns" HEAD -- frontend backend/app` (expect none) |
| 14 | Analytics | `git grep -il "posthog\|amplitude\|mixpanel\|segment\|gtag\|plausible" HEAD -- frontend backend/app` |
| 15 | Crash reporting | `git grep -il "sentry\|bugsnag\|@sentry" HEAD -- frontend backend/app` |
| 16 | Privacy setup | `git grep -il "privacy.?policy\|gdpr\|consent\|cookie.?banner" HEAD -- frontend docs` |
| 17 | Accessibility | `git grep -n "jsx-a11y\|core-web-vitals" HEAD -- frontend/eslint.config.mjs`; `git grep -c "aria-" HEAD -- frontend/components frontend/app`; `git grep -il "axe-core\|jest-axe" HEAD -- frontend/package.json` (expect none) |
| 18 | Responsiveness | `git grep -clE "\b(sm\|md\|lg\|xl\|2xl):" HEAD -- frontend/components frontend/app`; `git ls-files HEAD -- 'frontend/hooks/use-mobile.ts'` |
| 19 | User flows | `git ls-files HEAD -- '**/*playwright*' '**/*cypress*' 'e2e/**'` (expect empty); check `frontend/package.json` `scripts` for a test entry; `git ls-files HEAD -- 'backend/tests/*.py'` |
| 20 | Beta testers | `git ls-files HEAD -- 'frontend/lib/flags.ts'`; `git grep -c "NEXT_PUBLIC_MOCK" HEAD -- frontend/lib/flags.ts`; `git grep -il "waitlist\|beta.?program\|invite.?code" HEAD -- frontend backend/app` (expect none) |

---

## Phase D — Compose the title and body

### Title

Derive it from `git log --oneline origin/main..HEAD` — never from the branch name, and never by copying the tip commit's subject, which describes one commit rather than the branch.

- Conventional form `type(scope): subject`, imperative mood, no trailing period, **≤72 characters**.
- **Type** is the dominant type across the branch, biased to the most significant: `feat` beats `chore` beats `docs`.
- **Scope** only if the commits genuinely share one. When they span many areas, drop the scope rather than inventing one.
- **Because squash is the merge method, this title becomes the squash commit's subject on `main`.** That is why the format is a hard rule and not a style preference.

### Body

Write it to a temp file **outside the repo** and pass `--body-file`. Never `--body "$(cat …)"` — the body contains backticks, `$`, and pipe tables that shell quoting mangles.

````markdown
<1-2 sentences: what the branch does and why, naming the current state of `main`.>

<The derived change-scale sentence.>

## What's included

### Frontend
<Prose. Name actual files.>

### Backend
<Prose. Name actual files.>

### Tooling
<Prose. Name actual files.>

## Verification

Checks were run against this branch's content in an isolated git worktree, so results
reflect exactly what this PR contains and are unaffected by unrelated in-progress work
in the local tree.

| Check | Command | Result |
| --- | --- | --- |
| Install | `npm ci` | pass — N packages |
| Lint | `npm run lint` | pass — 0 errors |
| Build | `npm run build` | pass — compiled in Ts, N pages |
| Types | `npx tsc --noEmit` | pass — 0 errors |
| Backend tests | `python -m pytest -q` | pass — N passed in Ts |

## Production readiness

Swept against this branch's `HEAD` (`git grep`/`git ls-files`, no build
required) — informational only, never blocks this PR. Full evidence and
notes: `docs/PRODUCTION_READINESS.md`.

| # | Item | Status | Changed this PR |
| - | --- | --- | --- |
| 1 | Onboarding | <Status> | |
| 2 | Sign up / log in | <Status> | |
| 3 | Email verification | <Status> | |
| 4 | Password reset | <Status> | |
| 5 | Account deletion | <Status> | |
| 6 | User permissions | <Status> | |
| 7 | Empty states | <Status> | |
| 8 | Loading states | <Status> | |
| 9 | Error states | <Status> | |
| 10 | Network states | <Status> | |
| 11 | Data persistence | <Status> | |
| 12 | Payment flow | <Status> | |
| 13 | Notifications | <Status> | |
| 14 | Analytics | <Status> | |
| 15 | Crash reporting | <Status> | |
| 16 | Privacy setup | <Status> | |
| 17 | Accessibility | <Status> | |
| 18 | Responsiveness | <Status> | |
| 19 | User flows | <Status> | |
| 20 | Beta testers | <Status> | |

## Notes

- <honest caveats: stale docs, missing scripts, deprecated deps, tooling gaps>

Merge with **Squash and merge** — this branch's N commits land on `main` as one commit.
````

**Every cell must come from output you actually saw in this run.** Never a remembered constant, never a number carried over from a previous conversation.

---

## Phase E — Present the plan, then STOP

Print the proposed title, the full body, and the file list grouped by area. If Phase C found deltas, also show the `docs/PRODUCTION_READINESS.md` diff (old row → new row, per changed item) alongside it. Note anything the author must decide: pre-existing failures, skipped checks, secrets found, stale docs worth fixing first.

Then **stop and wait.** Do not push. Do not create the PR. The author may rewrite the title or body — apply their edits and re-present.

---

## Phase F — Push, only with permission

```bash
git status -sb
git log --oneline origin/main..HEAD
```

Show that, then **ask for explicit permission to push.** Approval granted in an earlier run does not carry over. On a clear yes:

If Phase C found deltas in `docs/PRODUCTION_READINESS.md`, write the proposed content to disk and commit it first, in its own small commit, following this repo's existing `docs(scope): subject` convention:

```bash
git add docs/PRODUCTION_READINESS.md
git commit -m "docs(readiness): refresh checklist (N changed)"
```

If Phase C found no deltas, skip this — no empty commit, no doc touch.

Then push — a branch with no upstream needs `-u`:

```bash
git push -u origin <current-branch>
```

### If the push is rejected for `.github/workflows`

`gh` in a Codespace is often authenticated from a `GITHUB_TOKEN` (`ghu_`) that lacks the `workflow` scope, and the restriction is enforced by a remote pre-receive hook — so `git push --dry-run` never detects it and an empty `X-Oauth-Scopes` header proves nothing. Match the rejection on `refusing to allow` plus `workflow`, then, in order:

1. **Split the push.** If the workflow lives in one trailing commit, push everything else and let the author add the file through the GitHub web UI, which runs as the user and is not restricted:
   ```bash
   git push -u origin HEAD~1:refs/heads/<current-branch>
   ```
   Print the exact target path and the full YAML for paste.
2. **Re-auth with a PAT.** An author action, not a silent one. `GITHUB_TOKEN` overrides stored credentials, so it must be unset in the same shell:
   ```bash
   unset GITHUB_TOKEN GH_TOKEN
   gh auth login --hostname github.com --git-protocol https --scopes 'repo,workflow'
   ```
3. **Drop `.github/` from this PR** and open a follow-up. A workflow on a branch does not run on `main` until merged anyway.

**Never** respond to this rejection by force-pushing, rewriting history, or deleting the workflow file.

---

## Phase G — Create the PR, print the URL, stop

```bash
gh pr create --base main --head <current-branch> \
  --title "<title>" --body-file /tmp/pr-body-$$.md
```

Print the URL. Report both job names the author should wait on. **Then stop.** Do not poll to merge, do not offer to merge, do not merge.

If the author wants to watch the checks: `gh pr checks <number> --watch`, and `gh run view --log-failed` on a red run.

---

## Hard safety rules

Never run any of these:

- `git push --force` / `--force-with-lease` — on any branch, for any reason, including after a workflow-scope rejection
- `gh pr merge` in any form — no `--auto`, no `--admin`, no `--squash`
- `git merge`, `git rebase`, `git cherry-pick` against the working tree — use `git merge-tree --write-tree` to answer conflict questions
- `git reset --hard`, `git checkout -- <file>`, `git clean`, `git stash drop`, `git stash clear`
- `rm -rf` on a worktree path — always `git worktree remove --force` then `git worktree prune`
- `npm ci` or `npm install` inside a worktree whose `node_modules` is a symlink
- `gh repo delete`, `gh pr close`, `git push --delete`
- `--no-verify` on commit or push

Never:

- push without explicit permission granted in the current conversation
- open a PR when any check failed, or when a skipped check would let the table imply it passed
- stage, commit, copy, `source`, or echo `backend/.env`, or put a real API key or `DATABASE_URL` anywhere
- edit source, weaken a lint rule, or add `@ts-expect-error` to make a check pass
- invent verification numbers — every cell in the table comes from output seen in this run
- treat a `Missing` or `N/A` production-readiness result as a failed check — Phase C is informational and never blocks Phase F/G
- write or commit `docs/PRODUCTION_READINESS.md` outside Phase F, or as a silent side effect of Phase C — it only ever happens together with explicit push permission
