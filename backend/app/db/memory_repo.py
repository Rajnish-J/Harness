"""Durable, cross-session memory: facts that outlive one conversation.

Same rules as the other repos: `%s` placeholders only, no DDL (Drizzle owns
`memory_entries`), `is not distinct from` where a lookup needs to match NULL
exactly, because `NULL = NULL` is NULL in SQL and NULL is exactly the value
that means "applies globally" on this table.

Two tiers, not two tables: a row with `project_id is null` is composed into
every project's system prompt (and the global chat's); a row with a
`project_id` set is composed into just that project's. `list_active` returns
the union of both for whichever scope was asked -- `prompt.py` treats every
row identically once loaded; the tier is only ever a WHERE clause here, never
a different shape.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID

from psycopg_pool import AsyncConnectionPool

logger = logging.getLogger(__name__)

#: Mirrors the `memory_kind` Postgres enum in frontend/db/schema.ts.
VALID_KINDS = ("preference", "feedback", "fact", "reference")

_SLUG_RE = re.compile(r"[^a-z0-9]+")


def slugify(title: str) -> str:
    """Derive a stable slug from a title. Shared by the `remember` tool and
    the admin API's create endpoint, so both key a memory the same way."""
    slug = _SLUG_RE.sub("-", title.lower()).strip("-")
    return slug[:80] or "note"


@dataclass
class MemoryRow:
    id: UUID
    project_id: UUID | None
    kind: str
    slug: str
    title: str
    content: str
    source: str
    session_id: str | None
    created_at: datetime
    updated_at: datetime


_COLUMNS = """
    id, project_id, kind, slug, title, content, source, session_id,
    created_at, updated_at
"""


def _row(record: dict[str, Any]) -> MemoryRow:
    return MemoryRow(
        id=record["id"],
        project_id=record["project_id"],
        kind=record["kind"],
        slug=record["slug"],
        title=record["title"],
        content=record["content"],
        source=record["source"],
        session_id=record["session_id"],
        created_at=record["created_at"],
        updated_at=record["updated_at"],
    )


async def list_active(
    pool: AsyncConnectionPool, project_id: str | None
) -> list[MemoryRow]:
    """Every non-archived memory in scope: global rows, plus this project's.

    Global rows (`project_id is null`) are always included -- they are meant
    to reach every conversation. A project's own rows are added on top when
    `project_id` is given; the global chat (`project_id is None`) sees only
    the global tier, never another project's facts, because `project_id =
    NULL` never matches under ordinary `=` semantics.

    Ordered by (kind, slug) for the same reason skills are sorted before
    composing them into the prompt: a stable order keeps the request prefix
    cacheable, and attaching/writing memories in a different order must not
    change the composed system prompt's bytes.
    """
    async with pool.connection() as conn, conn.cursor() as cur:
        await cur.execute(
            f"select {_COLUMNS} from memory_entries "  # noqa: S608 - no interpolated values
            "where archived_at is null "
            "and (project_id is null or project_id = %s) "
            "order by kind, slug",
            (project_id,),
        )
        return [_row(record) for record in await cur.fetchall()]


async def list_all(pool: AsyncConnectionPool) -> list[MemoryRow]:
    """Every active memory, in every scope, for the insights overview.

    `list_active` deliberately answers "what does a turn in THIS scope see",
    which is the right question for the prompt and the wrong one for a page
    that shows every project side by side. Global rows sort first (a NULL
    `project_id` is the broadest scope), then by project, so the caller can
    group without re-sorting.

    Unpaginated on purpose for now: memory is meant to be small enough to fit
    in a prompt, so a harness with enough rows to need paging has a bigger
    problem than this query.
    """
    async with pool.connection() as conn, conn.cursor() as cur:
        await cur.execute(
            f"select {_COLUMNS} from memory_entries "  # noqa: S608 - no interpolated values
            "where archived_at is null "
            "order by project_id nulls first, kind, slug"
        )
        return [_row(record) for record in await cur.fetchall()]


async def get_by_slug(
    pool: AsyncConnectionPool, project_id: str | None, slug: str
) -> MemoryRow | None:
    async with pool.connection() as conn, conn.cursor() as cur:
        await cur.execute(
            f"select {_COLUMNS} from memory_entries "  # noqa: S608 - no interpolated values
            "where project_id is not distinct from %s and slug = %s "
            "and archived_at is null",
            (project_id, slug),
        )
        record = await cur.fetchone()
    return _row(record) if record else None


async def upsert(
    pool: AsyncConnectionPool,
    *,
    project_id: str | None,
    kind: str,
    slug: str,
    title: str,
    content: str,
    source: str = "agent",
    session_id: str | None = None,
) -> MemoryRow:
    """Create or update one memory, keyed by (project_id, slug).

    Two different partial unique indexes back this table -- one for global
    rows, one for project-scoped rows (`memory_entries_global_slug_uq` /
    `memory_entries_project_slug_uq` in schema.ts) -- so the ON CONFLICT
    target is chosen to match whichever index this row's `project_id` falls
    under. A re-`remember()` of the same slug edits the existing row instead
    of accumulating duplicates, mirroring how editing MEMORY.md replaces a
    stanza rather than appending a new one, and revives it if it had been
    archived.
    """
    conflict_target = (
        "(slug) where project_id is null"
        if project_id is None
        else "(project_id, slug) where project_id is not null"
    )
    async with pool.connection() as conn:
        await conn.execute(
            f"""
            insert into memory_entries
                (project_id, kind, slug, title, content, source, session_id)
            values (%s, %s, %s, %s, %s, %s, %s)
            on conflict {conflict_target} do update set
                kind        = excluded.kind,
                title       = excluded.title,
                content     = excluded.content,
                source      = excluded.source,
                session_id  = excluded.session_id,
                archived_at = null,
                updated_at  = now()
            """,  # noqa: S608 - conflict_target is one of two fixed strings, never user input
            (project_id, kind, slug, title, content, source, session_id),
        )

    row = await get_by_slug(pool, project_id, slug)
    assert row is not None, "just inserted/updated this exact (project_id, slug)"
    return row


async def update(
    pool: AsyncConnectionPool,
    memory_id: str,
    *,
    title: str | None = None,
    content: str | None = None,
    kind: str | None = None,
) -> MemoryRow | None:
    """Partial edit from the admin page. Only the given fields change."""
    async with pool.connection() as conn, conn.cursor() as cur:
        await cur.execute(
            f"""
            update memory_entries set
                title      = coalesce(%s, title),
                content    = coalesce(%s, content),
                kind       = coalesce(%s, kind),
                updated_at = now()
            where id = %s
            returning {_COLUMNS}
            """,  # noqa: S608 - no interpolated values, only the fixed _COLUMNS constant
            (title, content, kind, memory_id),
        )
        record = await cur.fetchone()
    return _row(record) if record else None


async def archive(pool: AsyncConnectionPool, memory_id: str) -> bool:
    """Soft delete, same discipline as `projects.archived_at`: the row stays
    for audit rather than being erased outright."""
    async with pool.connection() as conn, conn.cursor() as cur:
        await cur.execute(
            "update memory_entries set archived_at = now(), updated_at = now() "
            "where id = %s and archived_at is null",
            (memory_id,),
        )
        return cur.rowcount > 0
