---
name: commit
description: Split the current staged and edited files into small, feature-scoped commits (2-8 files each), verify each batch typechecks before committing, present the full batch plan for author approval before anything is committed, and push only with explicit permission. Use when the working tree has many changed files that should not all go into one commit.
---

# Batched commit workflow

Turn a large pile of uncommitted changes into a series of small, reviewable, feature-scoped commits.

**The two rules that override everything else in this file:**

1. **Never commit anything until the author has approved the batch plan.**
2. **Never push until the author has explicitly granted permission, in this conversation.**

## Project commands

This project uses **npm** (`pnpm-lock.yaml` and `pnpm-workspace.yaml` are leftover v0 artifacts — `node_modules` is npm-installed and `pnpm` is not on this machine; prefer `package-lock.json`).

| Purpose   | Command                              |
| --------- | ------------------------------------ |
| Typecheck | `npm run typecheck` (`tsc --noEmit`) |
| Lint      | `npm run lint` (`eslint .`)          |
| Build     | `npm run build` (`next build`)       |

---

## Phase A — Survey

Get the **real** file list. Plain `git status` collapses untracked directories, so `app/` can hide eight files:

```bash
git status --porcelain --untracked-files=all
git diff --stat
git diff --cached --stat
```

If there are no changes, say so and stop — do not invent work.

Then **read the diffs**. Grouping must be based on what the code _does_, not on filename or directory similarity alone. For untracked files, read the file; for modified files, read `git diff -- <path>`.

### Stop immediately if the tree contains secrets

Scan paths for `.env`, `*.pem`, `*.key`, `id_rsa`, `*credentials*`, and scan added diff lines for `sk-`, `re_` (Resend — this project uses Resend in `app/api/contact/route.ts`), `AKIA`, `ghp_`, `-----BEGIN * PRIVATE KEY-----`.

If anything matches, **stop before staging anything**, report it, and let the author decide. Do not commit it and do not "fix" it by deleting their file.

### Flag files that should be ignored, not committed

Generated files (`next-env.d.ts`, `.next/`, `*.tsbuildinfo`) belong in `.gitignore`. Propose that instead of putting them in a batch.

---

## Phase B — Build the batch plan

### Grouping

Group by **feature or functionality** — a batch should be one coherent unit a reviewer can hold in their head. In rough priority order:

1. **Tooling and config** — `package.json`, lockfile, `tsconfig.json`, `next.config.mjs`, `eslint.config.mjs`, `postcss.config.mjs`
2. **Shared foundation** — `lib/`, `app/layout.tsx`, `app/globals.css`
3. **Feature / route areas** — `app/blog/*` together with the components only that route uses
4. **Static assets** — images and documents, grouped with their feature when they clearly belong to one
5. **Docs** — `README.md`, `CLAUDE.md`

A component belongs with the route that consumes it, not in a generic "components" bucket — unless it is genuinely shared across several routes, in which case it goes in the foundation batch.

### Size

**Minimum 2 files. Maximum 8. Target 3-6.**

- A feature needing more than 8 files splits along a sensible seam, with messages like `feat(journey): add journey page (1/2)`.
- A leftover that cannot reach 2 files folds into the nearest genuinely related batch.
- If a file is genuinely standalone and has no related batch, commit it alone rather than padding an unrelated batch with it — and say explicitly that you did so and why.

### Ordering — this is what makes batches independently buildable

**A batch may only import from files in itself or an earlier batch.**

Before finalizing, walk each batch's `import` statements against the full changed-file list. If batch 3 imports a module first introduced in batch 6, either reorder the batches or merge them. This is why config and `lib/` land early and leaf pages land late.

### Commit messages

Conventional commits: `type(scope): subject`

- `type` ∈ `feat` | `fix` | `chore` | `docs` | `refactor` | `style` | `test` | `perf`
- Subject: imperative mood, no trailing period, ≤72 characters
- Body: 1-4 bullets explaining **why** the change exists and what it enables — never a restatement of the file list, which git already records

---

## Phase C — Present the plan, then STOP

Print a table with one row per batch:

| #   | Commit message | Files | Why |
| --- | -------------- | ----- | --- |

Below the table, note anything the author needs to decide: files you excluded, ignore-list proposals, single-file batches, secrets found.

Then **stop and wait.** Do not run `git add`. Do not run `git commit`. The author may reshuffle groupings or rewrite messages — apply their edits and re-present the revised table for approval.

---

## Phase D — Execute, one batch at a time

Only after approval. For each batch in order:

```bash
git reset                              # clean index; start each batch from zero
git add -- <explicit file paths>       # never a bare directory
git status --short                     # confirm exactly the intended files are staged
npm run typecheck
git commit -m "type(scope): subject" -m "- body bullet" -m "- body bullet"
```

**If the typecheck fails: stop. Do not commit.** Report the errors, leave the batch staged so the author can inspect it, and do not proceed to later batches.

> **What the per-batch typecheck does and does not prove.** `tsc --noEmit` checks the _working tree_, not the staged snapshot, so on its own it does not prove that commit N compiles in isolation — every run sees the same complete tree. The isolation guarantee comes from the import-ordering rule in Phase B. The per-batch run still earns its place: it catches a tree that breaks partway through, such as the author editing a file between batches. Do not describe it to the author as more than that.

**Optional `--strict` mode** (only when the author asks for it): after all commits, verify true per-commit isolation by checking each commit out into a throwaway worktree (`git worktree add`) and typechecking there. Slower, off by default. Never use `git stash` against the author's working tree.

---

## Phase E — Final verification

After the last batch:

```bash
npm run lint
npm run build
```

Report the results honestly. If either fails, say so with the output and tell the author the commits exist locally and can be corrected with a follow-up commit or `git reset --soft`. **Do not auto-amend, auto-reset, or auto-fix.**

Known pre-existing lint state: the v0-generated code carries warnings and one `react-hooks/set-state-in-effect` error in `components/theme-toggle.tsx`. Do not silently fix these as part of a commit run and do not weaken lint rules to make the step pass — report and move on.

---

## Phase F — Push, only with permission

```bash
git log --oneline @{u}..HEAD           # exactly what would go out
git status -sb
```

Show that to the author, then **ask for explicit permission to push.** Push only on a clear yes:

```bash
git push origin <current-branch>
```

If the author declines, say the commits are local and stop. That is a complete, successful outcome — not a failure.

Approval granted in an earlier run does **not** carry over to a later one. Ask every time.

---

## Hard safety rules

Never run any of these:

- `git add -A`, `git add .`, or `git add <directory>` — always explicit file paths
- `git commit --amend` on a commit that has already been pushed
- `git reset --hard`, `git checkout -- <file>`, `git clean` — these destroy the author's work
- `git stash drop`, `git stash clear`
- `git push --force` / `--force-with-lease`
- `--no-verify` on commit or push

Never push without explicit approval in the current conversation. Never commit a file the author did not see in the approved plan.