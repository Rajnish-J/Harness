"""Durable, cross-session memory: facts that outlive one conversation.

Same rules as the other repos: `%s` placeholders only, no DDL (Drizzle owns
`memory_entries`), `is not distinct from` where a lookup needs to match NULL
exactly, because `NULL = NULL` is NULL in SQL and NULL is exactly the value
that means "applies globally" on this table.

Three tiers, not three tables: a row with `project_id is null` is composed
into every project's system prompt (and the global chat's); a row with a
`project_id` set is composed into just that project's; and a row with
`scoped_session_id` set reaches exactly one conversation, whatever its
project. `list_active` returns the union of whichever apply to the scope asked
for -- `prompt.py` treats every row identically once loaded; the tier is only
ever a WHERE clause here, never a different shape.

`scoped_session_id` is the discriminator, and it is NOT `session_id`: that
column is provenance and is stamped on every agent-written row regardless of
scope, so reading it as a scope would demote every existing memory to the chat
that happened to write it.
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
    #: Defaulted so the four test suites that build a row from an explicit
    #: field list keep working; every real read fills it from _COLUMNS.
    scoped_session_id: str | None = None


_COLUMNS = """
    id, project_id, kind, slug, title, content, source, session_id,
    scoped_session_id, created_at, updated_at
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
        scoped_session_id=record["scoped_session_id"],
        created_at=record["created_at"],
        updated_at=record["updated_at"],
    )


async def list_active(
    pool: AsyncConnectionPool,
    project_id: str | None,
    session_id: str | None = None,
) -> list[MemoryRow]:
    """Every non-archived memory a turn in this scope sees.

    Global rows (`project_id is null`) are always included -- they are meant
    to reach every conversation. A project's own rows are added on top when
    `project_id` is given; the global chat (`project_id is None`) sees only
    the global tier, never another project's facts, because `project_id =
    NULL` never matches under ordinary `=` semantics.

    `scoped_session_id is null` on that first disjunct is what keeps the
    conversation tier OUT of the other two. Without it every conversation
    memory ever written would leak into every chat, which is the exact
    opposite of what the tier is for.

    The second disjunct adds this conversation's own rows. Note the plain `=`
    rather than the `is not distinct from` used elsewhere in this module: with
    no `session_id`, `scoped_session_id = NULL` is NULL, so the disjunct
    contributes nothing and the answer is the same two tiers callers got
    before this parameter existed. That is deliberate -- this is the one place
    where `= NULL` matching nothing is the point.

    Ordered by (kind, slug) for the same reason skills are sorted before
    composing them into the prompt: a stable order keeps the request prefix
    cacheable, and attaching/writing memories in a different order must not
    change the composed system prompt's bytes.
    """
    async with pool.connection() as conn, conn.cursor() as cur:
        await cur.execute(
            f"select {_COLUMNS} from memory_entries "  # noqa: S608 - no interpolated values
            "where archived_at is null and ("
            "  (scoped_session_id is null"
            "   and (project_id is null or project_id = %s))"
            "  or (scoped_session_id is not null and scoped_session_id = %s)"
            ") "
            "order by kind, slug",
            (project_id, session_id),
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
    pool: AsyncConnectionPool,
    project_id: str | None,
    slug: str,
    scoped_session_id: str | None = None,
) -> MemoryRow | None:
    """One memory, addressed the way its tier keys it.

    `is not distinct from` on BOTH scope columns: either can legitimately be
    NULL, and on both of them NULL is a value that carries meaning rather than
    an absence -- so ordinary `=` would match nothing exactly when it matters.
    """
    async with pool.connection() as conn, conn.cursor() as cur:
        await cur.execute(
            f"select {_COLUMNS} from memory_entries "  # noqa: S608 - no interpolated values
            "where project_id is not distinct from %s "
            "and scoped_session_id is not distinct from %s "
            "and slug = %s "
            "and archived_at is null",
            (project_id, scoped_session_id, slug),
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
    scoped_session_id: str | None = None,
) -> MemoryRow:
    """Create or update one memory, keyed by its tier's identity.

    Three partial unique indexes back this table, one per tier
    (`memory_entries_global_slug_uq` / `_project_slug_uq` / `_session_slug_uq`
    in schema.ts), so the ON CONFLICT target is chosen to match whichever this
    row falls under. Postgres infers the target by matching the predicate
    against an index's own WHERE clause, so these three strings have to track
    those three definitions exactly -- a mismatch is not a silent fallback but
    a hard "no unique or exclusion constraint matching the ON CONFLICT
    specification" on every write.

    A re-`remember()` of the same slug edits the existing row instead of
    accumulating duplicates, mirroring how editing MEMORY.md replaces a stanza
    rather than appending a new one, and revives it if it had been archived.
    """
    if scoped_session_id is not None:
        # The conversation tier ignores project_id entirely: a session belongs
        # to at most one project, so the session id alone identifies the row.
        conflict_target = "(scoped_session_id, slug) where scoped_session_id is not null"
    elif project_id is None:
        conflict_target = (
            "(slug) where project_id is null and scoped_session_id is null"
        )
    else:
        conflict_target = (
            "(project_id, slug) "
            "where project_id is not null and scoped_session_id is null"
        )

    async with pool.connection() as conn:
        await conn.execute(
            f"""
            insert into memory_entries
                (project_id, kind, slug, title, content, source, session_id,
                 scoped_session_id)
            values (%s, %s, %s, %s, %s, %s, %s, %s)
            on conflict {conflict_target} do update set
                kind        = excluded.kind,
                title       = excluded.title,
                content     = excluded.content,
                source      = excluded.source,
                session_id  = excluded.session_id,
                archived_at = null,
                updated_at  = now()
            """,  # noqa: S608 - conflict_target is one of three fixed strings, never user input
            (
                project_id,
                kind,
                slug,
                title,
                content,
                source,
                session_id,
                scoped_session_id,
            ),
        )

    row = await get_by_slug(pool, project_id, slug, scoped_session_id)
    assert row is not None, "just inserted/updated this exact (scope, slug)"
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
