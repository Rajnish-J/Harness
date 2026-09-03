# Production readiness

A 20-point checklist of what a codebase needs before it's safe to ship to
production, swept fresh against `HEAD` and refreshed by
[`/prepare-pr`](../.claude/skills/prepare-pr/SKILL.md)'s Phase C on every run.
**Informational only — never blocks a PR.** See that skill for the exact
detection commands behind each row.

Hand-maintained alongside a machine-refreshed `Status`/`Evidence`, unlike
[`BRANCHES.md`](./BRANCHES.md) which is fully generated. `Notes` is
human-authored prose that `/prepare-pr` only ever appends a short transition
line to — it never deletes or rewrites what a person wrote here. For history
of when a row's status last changed and why, see `git log -- docs/PRODUCTION_READINESS.md`.

## Status legend

| Status | Meaning |
| --- | --- |
| `Done` | Real implementation exists and broadly covers the concern. |
| `Partial` | Real implementation exists but doesn't fully cover the concern — see Notes. |
| `Missing` | No implementation, and nothing architectural excuses that — a genuine gap. |
| `N/A (deliberate)` | Out of scope *because* of the current single-user/local-only design (see [`PENDING.md`](./PENDING.md)'s cross-cutting note: "Single user, no auth... a deliberate property of a localhost harness... stops being true the moment this is exposed to a network"). Becomes a real item again once auth or hosted deployment lands. |

## Status at a glance

| # | Item | Status | Evidence | Notes |
| - | --- | --- | --- | --- |
| 1 | Onboarding | Missing | — | No first-run wizard or onboarding flow anywhere. |
| 2 | Sign up / log in | N/A (deliberate) | `docs/PENDING.md` cross-cutting note | No auth by design — single operator, localhost only. |
| 3 | Email verification | N/A (deliberate) | same | No user accounts to verify. |
| 4 | Password reset | N/A (deliberate) | same | No accounts, no passwords. |
| 5 | Account deletion | N/A (deliberate) | `backend/app/api/projects.py: purge_project`, `DeleteProjectDialog.tsx` | No user account object exists; *project* deletion is a separate, already-`Done` concern. |
| 6 | User permissions | N/A (deliberate) | same cross-cutting note | Single user has full access by construction; `role` hits in code are chat-message roles or ARIA `role=`, not RBAC. |
| 7 | Empty states | Partial | `frontend/components/registry/EmptyState.tsx` — 8 consumers: `CredentialsExplorer.tsx`, `MemoryBrowser.tsx`, `MemoryGroupList.tsx`, `MemoryInsights.tsx`, `ProjectsExplorer.tsx`, `RegistryGrid.tsx`, `ToolsBrowser.tsx` | Real, reused pattern across main list views. |
| 8 | Loading states | Partial | `frontend/components/ui/skeleton.tsx`; `Loader2`/`isLoading`/`isPending` across 9 files | Widely used but not systematic/audited. |
| 9 | Error states | Partial | `frontend/components/ui/toast.tsx`, `frontend/lib/toast.ts` | No `error.tsx`/`global-error.tsx`/`not-found.tsx` route boundaries under `frontend/app/` — error surfacing is ad hoc via toasts only. |
| 10 | Network states | Partial | `frontend/components/shell/HarnessStatus.tsx`, mock-mode short-circuit in `frontend/lib/api.ts` | Covers backend-liveness, not client-side offline detection (no `navigator.onLine` handling). |
| 11 | Data persistence | Done | `frontend/db/schema.ts` + 12 Drizzle migrations (`0000..0011*.sql`), 8 `backend/app/db/*_repo.py` + `pool.py` (psycopg pool) | Drizzle owns schema/migrations; backend queries the same Postgres DB via a hand-written repo layer. |
| 12 | Payment flow | N/A (deliberate) | — | No monetization surface for a local dev tool. |
| 13 | Notifications | Partial | `frontend/components/ui/toast.tsx`, `frontend/lib/toast.ts` | In-app toasts only — no email or push. |
| 14 | Analytics | Missing | — | No tracking/telemetry library anywhere (Next's own build telemetry is disabled in CI, which is unrelated). |
| 15 | Crash reporting | Missing | — | No Sentry or any error-tracking SDK. |
| 16 | Privacy setup | N/A (deliberate) | — | No external users' data is collected; revisit once hosted/multi-user. |
| 17 | Accessibility | Partial | `eslint.config.mjs` (`eslint-config-next/core-web-vitals`+`/typescript`, bundles `jsx-a11y`), ARIA usage across 42 files via radix-ui primitives | Linted in CI; no axe/a11y test tooling, no explicit `sr-only`/`VisuallyHidden`. |
| 18 | Responsiveness | Partial | Tailwind `sm:`/`md:`/`lg:`/`xl:` classes in 29 files, `frontend/hooks/use-mobile.ts` | Desktop-first coverage, not exhaustively responsive. |
| 19 | User flows | Missing | `backend/tests/*.py` (32 files, unit/component level) | No Playwright/Cypress/E2E, no `e2e/` dir, no frontend test runner at all. |
| 20 | Beta testers | Partial | `frontend/lib/flags.ts`, `frontend/components/shell/MockBadge.tsx` | Real feature-flag mechanism, purpose-built for mock-data toggling — not a user-facing beta/waitlist program. |
