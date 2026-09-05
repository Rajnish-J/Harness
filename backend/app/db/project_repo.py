"""Project reads, and `project_files` writes.

Same two rules as the other repos: every value goes through a ``%s`` placeholder,
and no module here emits DDL — Drizzle owns every table.

The ownership split is the thing to keep straight, and it is not the same as
credential_repo.py:

- ``projects`` is **read** here. Next.js owns it, because it is operator config.
  The one exception is `clone_status` and its companion columns, which record
  what a clone attempt *did* — that is execution state, and Python is the only
  thing that knows it. Those three writes are listed explicitly below rather
  than left to a general-purpose update, so the boundary stays visible.
- ``project_files`` is **written** here and nowhere else. It is derived from a
  checkout on disk, and Python is what produces it.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Sequence
from uuid import UUID

from psycopg_pool import AsyncConnectionPool

logger = logging.getLogger(__name__)


@dataclass
class ProjectRow:
    id: UUID
    name: str
    slug: str
    provider: str
    # Null for a Blank Project until it is connected to a remote.
    repo_owner: str | None
    repo_name: str | None
    repo_url: str | None
    default_branch: str
    credential_id: UUID | None
    clone_status: str
    current_branch: str | None


@dataclass
class ProjectSummary:
    """A project as a *picker* needs it: enough to name one, nothing more.

    Deliberately not ProjectRow. That shape carries credential_id and repo_url
    because the execution paths need them, and the one caller of this is a tool
    whose output is stringified into a model's prompt -- so it gets its own
    narrow select list rather than a wide row that happens to be handy.
    """

    id: UUID
    name: str
    slug: str
    updated_at: datetime


_COLUMNS = """
    id, name, slug, provider, repo_owner, repo_name, repo_url,
    default_branch, credential_id, clone_status, current_branch
"""


def _row(record: dict[str, Any]) -> ProjectRow:
    return ProjectRow(
        id=record["id"],
        name=record["name"],
        slug=record["slug"],
        provider=record["provider"],
        repo_owner=record["repo_owner"],
        repo_name=record["repo_name"],
        repo_url=record["repo_url"],
        default_branch=record["default_branch"],
        credential_id=record["credential_id"],
        clone_status=record["clone_status"],
        current_branch=record["current_branch"],
    )


async def get_project(pool: AsyncConnectionPool, project_id: str) -> ProjectRow | None:
    """One live project by id. Archived rows are invisible to the backend."""
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                f"select {_COLUMNS} from projects "  # noqa: S608
                "where id = %s and archived_at is null",
                (project_id,),
            )
            record = await cur.fetchone()

    return _row(record) if record else None


async def get_project_any_state(
    pool: AsyncConnectionPool, project_id: str
) -> ProjectRow | None:
    """One project by id, archived or not.

    The only read that deliberately ignores `archived_at`, and it exists for
    exactly one caller: purging a project's checkout happens *after* the row has
    been archived, so `get_project` — which every other endpoint wants — would
    report the project missing at precisely the moment we need to clean up after
    it. Kept as a separate function rather than a flag on `get_project` so a
    caller cannot reach an archived project by accident.
    """
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                f"select {_COLUMNS} from projects where id = %s",  # noqa: S608
                (project_id,),
            )
            record = await cur.fetchone()

    return _row(record) if record else None


async def list_projects(
    pool: AsyncConnectionPool, *, limit: int = 50
) -> list[ProjectSummary]:
    """Live projects, most recently touched first.

    Next.js owns `projects` and lists it for the UI; this exists for the agent,
    which needs candidate ids before it can offer to file a conversation under
    one. A read, so the ownership boundary in this module's header does not
    move.

    `archived_at is null` matters more than it looks: attach_session_to_project
    does not check that its target exists, so surfacing an archived project here
    would let a conversation be filed under one nothing can open again.
    """
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "select id, name, slug, updated_at from projects "
                "where archived_at is null "
                "order by updated_at desc limit %s",
                (limit,),
            )
            records = await cur.fetchall()

    return [
        ProjectSummary(
            id=record["id"],
            name=record["name"],
            slug=record["slug"],
            updated_at=record["updated_at"],
        )
        for record in records
    ]


async def mark_clone_started(pool: AsyncConnectionPool, project_id: str) -> None:
    async with pool.connection() as conn:
        await conn.execute(
            "update projects set clone_status = 'cloning', clone_error = null, "
            "updated_at = now() where id = %s",
            (project_id,),
        )


async def mark_clone_succeeded(
    pool: AsyncConnectionPool, project_id: str, *, branch: str | None
) -> None:
    async with pool.connection() as conn:
        await conn.execute(
            "update projects set clone_status = 'ready', clone_error = null, "
            "current_branch = %s, last_pulled_at = %s, updated_at = now() "
            "where id = %s",
            (branch, datetime.now(timezone.utc), project_id),
        )


async def mark_clone_failed(
    pool: AsyncConnectionPool, project_id: str, *, error: str
) -> None:
    # Truncated: git can emit a great deal on failure, and the column feeds a
    # card subtitle. The full text is in the stream the operator just watched.
    async with pool.connection() as conn:
        await conn.execute(
            "update projects set clone_status = 'error', clone_error = %s, "
            "updated_at = now() where id = %s",
            (error[:2000], project_id),
        )


async def replace_project_files(
    pool: AsyncConnectionPool,
    project_id: str,
    files: Sequence[Any],
) -> int:
    """Swap in a fresh index for one project, atomically.

    Delete-then-insert in a single transaction rather than diffing: a re-index
    already has the complete new state in hand, so computing a delta would be
    work in service of nothing. The transaction is what matters — the UI must
    never observe a half-replaced tree.
    """
    if not files:
        async with pool.connection() as conn:
            await conn.execute(
                "delete from project_files where project_id = %s", (project_id,)
            )
        return 0

    rows = [
        (
            project_id,
            f.path,
            f.dir_path,
            f.name,
            f.ext,
            f.size_bytes,
            f.is_binary,
            f.git_blob_sha,
        )
        for f in files
    ]

    async with pool.connection() as conn:
        # autocommit is on for this pool, so the transaction is explicit.
        async with conn.transaction():
            await conn.execute(
                "delete from project_files where project_id = %s", (project_id,)
            )
            async with conn.cursor() as cur:
                await cur.executemany(
                    "insert into project_files "
                    "(project_id, path, dir_path, name, ext, size_bytes, "
                    " is_binary, git_blob_sha) "
                    "values (%s, %s, %s, %s, %s, %s, %s, %s)",
                    rows,
                )

    return len(rows)
