"""Durable chat, project-scoped or global.

Writes both chat tables. Same rules as the other repos -- `%s` placeholders
only, no DDL -- plus the split those two tables encode:

- ``project_chat_sessions`` is what the MODEL needs to continue: a
  provider-native message list, stored opaquely because it is Anthropic's or
  OpenAI's format and parsing it here would couple the schema to a vendor.
- ``project_chat_messages`` is what the PAGE needs to repaint: the rendered
  transcript, in the order it was shown.

``project_id`` is nullable on both tables: NULL is the chat on `/`, a string is
a project's. The global chat used to stay in memory only -- `SessionStore`'s
own doc comment still describes that milestone -- and everything here now
treats NULL exactly like any other project_id, via `is not distinct from`
rather than `=`, which is the one place NULL needs different SQL than a value.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Sequence

from psycopg import sql as _sql  # noqa: F401  (kept for parity with other repos)
from psycopg.types.json import Json
from psycopg_pool import AsyncConnectionPool

logger = logging.getLogger(__name__)

# Truncated to this many characters when a session's first user message
# becomes its title. Long enough to be recognisable, short enough for a
# sidebar row.
_TITLE_MAX_LEN = 80


@dataclass
class StoredSession:
    provider: str
    history: list[Any] = field(default_factory=list)


@dataclass
class TranscriptEntry:
    """One rendered line of the transcript."""

    role: str
    content: str | None = None
    tool_name: str | None = None
    tool_call_id: str | None = None
    tool_args: dict[str, Any] | None = None
    is_error: bool = False
    input_tokens: int | None = None
    output_tokens: int | None = None


@dataclass
class SessionSummary:
    """One row for a conversation-history list -- never the full transcript."""

    session_id: str
    updated_at: datetime
    message_count: int
    title: str
    #: When this conversation was pinned, or None. Defaulted so a caller that
    #: builds a summary without it -- a test fake, say -- still constructs.
    pinned_at: datetime | None = None


async def load_session(
    pool: AsyncConnectionPool, session_id: str
) -> StoredSession | None:
    """The provider-native history for a session, if one was ever saved."""
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "select provider, history from project_chat_sessions "
                "where session_id = %s",
                (session_id,),
            )
            record = await cur.fetchone()

    if record is None:
        return None
    history = record["history"]
    # jsonb comes back decoded, but a string would mean someone stored a JSON
    # document rather than an array -- tolerate it rather than crash a chat.
    if isinstance(history, str):
        try:
            history = json.loads(history)
        except ValueError:
            history = []
    return StoredSession(provider=record["provider"], history=list(history or []))


async def save_session(
    pool: AsyncConnectionPool,
    project_id: str | None,
    session_id: str,
    *,
    provider: str,
    history: Sequence[Any],
) -> None:
    """Persist the provider-native history after a turn.

    Upsert on session_id: the row is rewritten wholesale every turn because the
    history is a single opaque document, and diffing an LLM's message list would
    buy nothing.
    """
    async with pool.connection() as conn:
        await conn.execute(
            """
            insert into project_chat_sessions
                (project_id, session_id, provider, history)
            values (%s, %s, %s, %s)
            on conflict (session_id) do update set
                provider   = excluded.provider,
                history    = excluded.history,
                updated_at = now()
            """,
            (project_id, session_id, provider, Json(list(history))),
        )


async def append_messages(
    pool: AsyncConnectionPool,
    project_id: str | None,
    session_id: str,
    entries: Sequence[TranscriptEntry],
) -> int:
    """Append rendered transcript lines, continuing this session's numbering.

    `seq` continues from the current maximum, serialised by a transaction-scoped
    advisory lock on the session. Two concurrent turns on one session must not
    mint the same number, and a timestamp would not do either: several events
    within one turn share a millisecond, and the transcript's order has to be
    exact.

    The lock rather than `SELECT ... FOR UPDATE`: Postgres refuses row locks
    alongside an aggregate, and there is no single row to lock anyway — the
    thing being serialised is "the next number for this session".
    """
    if not entries:
        return 0

    async with pool.connection() as conn:
        async with conn.transaction():
            async with conn.cursor() as cur:
                # Released automatically when the transaction ends.
                await cur.execute(
                    "select pg_advisory_xact_lock(hashtext(%s))", (session_id,)
                )
                await cur.execute(
                    "select coalesce(max(seq), -1) as last from project_chat_messages "
                    "where session_id = %s",
                    (session_id,),
                )
                row = await cur.fetchone()
                seq = int(row["last"]) + 1

                await cur.executemany(
                    """
                    insert into project_chat_messages
                        (project_id, session_id, seq, role, content, tool_name,
                         tool_call_id, tool_args, is_error, input_tokens,
                         output_tokens)
                    values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    [
                        (
                            project_id,
                            session_id,
                            seq + offset,
                            entry.role,
                            entry.content,
                            entry.tool_name,
                            entry.tool_call_id,
                            Json(entry.tool_args) if entry.tool_args else None,
                            entry.is_error,
                            entry.input_tokens,
                            entry.output_tokens,
                        )
                        for offset, entry in enumerate(entries)
                    ],
                )
    return len(entries)


#: The projection both listing queries share. They differ only in their WHERE
#: and ORDER BY, and they drifted into two character-identical copies once
#: already -- a column added to one and not the other silently gives half the
#: callers a stale summary. Static SQL concatenated with static SQL; every
#: value still arrives through a %s placeholder.
_SUMMARY_SELECT = """
    select
        s.session_id,
        s.updated_at,
        s.pinned_at,
        (
            select count(*) from project_chat_messages m
            where m.session_id = s.session_id
        ) as message_count,
        (
            select m.content from project_chat_messages m
            where m.session_id = s.session_id and m.role = 'user'
            order by m.seq asc
            limit 1
        ) as title_source
    from project_chat_sessions s
"""


def _summary(row: dict[str, Any]) -> SessionSummary:
    return SessionSummary(
        session_id=row["session_id"],
        updated_at=row["updated_at"],
        message_count=int(row["message_count"]),
        title=_derive_title(row["title_source"]),
        pinned_at=row["pinned_at"],
    )


async def list_sessions(
    pool: AsyncConnectionPool, project_id: str | None, *, limit: int = 50
) -> list[SessionSummary]:
    """Recent conversations for one scope -- a project, or the global chat when
    `project_id` is None.

    `is not distinct from` rather than `=`: NULL = NULL is NULL in SQL, which
    would match nothing, and NULL is exactly the value that means "the global
    chat" here.

    Titled by each session's first user message rather than a stored column --
    that message is already durable by the time a turn finishes (`_persist`
    in api/chat.py writes it before the assistant's reply comes back), so
    there is nothing to keep in sync by adding one. A session with no user
    message yet falls back to a placeholder.
    """
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                _SUMMARY_SELECT
                + """
                where s.project_id is not distinct from %s
                -- nulls last is mandatory, not decoration: Postgres defaults
                -- DESC to NULLS FIRST, which would float every UNPINNED chat
                -- above every pinned one and invert the whole feature.
                order by s.pinned_at desc nulls last, s.updated_at desc
                limit %s
                """,
                (project_id, limit),
            )
            rows = await cur.fetchall()

    return [_summary(row) for row in rows]


async def list_sessions_by_ids(
    pool: AsyncConnectionPool, session_ids: Sequence[str]
) -> list[SessionSummary]:
    """Look up specific conversations by id, for showing where something came from.

    `list_sessions` answers "what conversations exist in this scope"; this
    answers "what were THESE conversations", which is what a memory's
    `session_id` provenance needs — only the handful of sessions that actually
    produced a memory get resolved, rather than every session in every project.

    Ids with no row are simply absent from the result rather than raising: a
    session can be hard-deleted by `clear_session` while a memory keeps its id,
    so a dangling reference is expected, not exceptional.

    `= any(%s)` with a list parameter rather than a built IN list — the same
    rule the rest of the repo layer follows for a set of values.
    """
    if not session_ids:
        return []

    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                # Ordering deliberately untouched by pinning: this answers a
                # provenance question, where which chats are pinned is noise.
                _SUMMARY_SELECT
                + """
                where s.session_id = any(%s)
                order by s.updated_at desc
                """,
                (list(session_ids),),
            )
            rows = await cur.fetchall()

    return [_summary(row) for row in rows]


def _derive_title(first_user_message: str | None) -> str:
    if not first_user_message or not first_user_message.strip():
        return "New conversation"
    first_line = first_user_message.strip().splitlines()[0]
    if len(first_line) > _TITLE_MAX_LEN:
        return first_line[:_TITLE_MAX_LEN].rstrip() + "…"
    return first_line


async def load_transcript_for_session(
    pool: AsyncConnectionPool, session_id: str, *, limit: int = 500
) -> list[dict[str, Any]]:
    """The rendered transcript for exactly one conversation, oldest first.

    `load_transcript` below answers "this project's current chat" -- fine when
    there is one live session per project. Reopening a PAST conversation needs
    to address a specific session instead, now that old ones survive "New
    chat" rather than being overwritten, so this keys off session_id. Same
    newest-first-then-reverse trick: an ascending order with a LIMIT would keep
    the oldest end of a long conversation rather than the recent one.
    """
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                select session_id, seq, role, content, tool_name, tool_call_id,
                       tool_args, is_error
                from project_chat_messages
                where session_id = %s
                order by seq desc
                limit %s
                """,
                (session_id, limit),
            )
            rows = await cur.fetchall()

    return [dict(row) for row in reversed(rows)]


async def load_transcript(
    pool: AsyncConnectionPool, project_id: str, *, limit: int = 500
) -> list[dict[str, Any]]:
    """The most recent transcript for a project, oldest first.

    Ordered by (session, seq) and capped: a long-running project chat should
    repaint quickly rather than replay a year of history.
    """
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                select session_id, seq, role, content, tool_name, tool_call_id,
                       tool_args, is_error
                from project_chat_messages
                where project_id = %s
                order by created_at desc, seq desc
                limit %s
                """,
                (project_id, limit),
            )
            rows = await cur.fetchall()

    # Fetched newest-first so the LIMIT keeps the RECENT end, then reversed for
    # display. Ordering ascending with a limit would keep the oldest instead.
    return [dict(row) for row in reversed(rows)]


async def clear_session(pool: AsyncConnectionPool, session_id: str) -> None:
    """Forget one conversation. Used when the operator starts a new chat."""
    async with pool.connection() as conn:
        async with conn.transaction():
            await conn.execute(
                "delete from project_chat_messages where session_id = %s",
                (session_id,),
            )
            await conn.execute(
                "delete from project_chat_sessions where session_id = %s",
                (session_id,),
            )


class SessionNotFoundError(LookupError):
    """No conversation with this session id has been persisted yet."""

    def __init__(self, session_id: str) -> None:
        self.session_id = session_id
        super().__init__(
            f"No stored conversation for session {session_id!r}. A session is "
            "written when its first turn completes, so one that has never "
            "finished a turn cannot be adopted yet."
        )


async def attach_session_to_project(
    pool: AsyncConnectionPool, session_id: str, project_id: str | None
) -> int:
    """Re-file one conversation under a project (or back to global).

    Both tables in ONE transaction, because they answer the same question from
    two sides: `list_sessions` reads project_chat_sessions and `load_transcript`
    reads project_chat_messages. Half-applying this leaves a conversation the
    sidebar files as global whose messages a project's page shows -- exactly the
    split the write-once `project_id` below exists to keep from drifting into.

    This is the ONLY sanctioned writer of project_chat_sessions.project_id after
    insert. `save_session` deliberately leaves it out of its upsert so that a
    stale browser tab -- still posting `project_id: null` from before an
    adoption -- cannot re-home a conversation as a side effect of an ordinary
    turn. Adoption is an explicit act, so it gets an explicit call.

    That same omission is what makes a concurrent turn harmless here: the
    advisory lock serialises this against `append_messages`, and if a turn's
    `_persist` lands afterwards with the old project_id, `save_session` ignores
    the column and only the history is rewritten.

    Returns the number of transcript rows re-filed.
    """
    async with pool.connection() as conn:
        async with conn.transaction():
            async with conn.cursor() as cur:
                # The same lock append_messages takes, so a turn cannot
                # interleave an INSERT between the two UPDATEs below.
                await cur.execute(
                    "select pg_advisory_xact_lock(hashtext(%s))", (session_id,)
                )
                await cur.execute(
                    "update project_chat_sessions "
                    "set project_id = %s, updated_at = now() "
                    "where session_id = %s",
                    (project_id, session_id),
                )
                sessions_updated = cur.rowcount
                if sessions_updated == 0:
                    # Raised inside the transaction so it rolls back; there is
                    # nothing to undo yet, but the messages UPDATE below must
                    # not run against a session that does not exist.
                    raise SessionNotFoundError(session_id)

                await cur.execute(
                    "update project_chat_messages set project_id = %s "
                    "where session_id = %s",
                    (project_id, session_id),
                )
                return cur.rowcount


async def set_session_pinned(
    pool: AsyncConnectionPool, session_id: str, pinned: bool
) -> bool:
    """Pin or unpin one conversation. False when no such session exists.

    Deliberately does NOT touch `updated_at`. Pinning is a filing decision, not
    activity, and bumping the timestamp would reorder the unpinned list as a
    side effect of tidying the pinned one. That is the opposite of
    `attach_session_to_project`, which does bump it -- because an adoption
    really does change what the conversation is.

    One statement rather than two branches: `pinned_at` is either now() or
    null, and a caller flipping a checkbox should not be able to hit a
    different code path in each direction.
    """
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "update project_chat_sessions "
                "set pinned_at = case when %s then now() else null end "
                "where session_id = %s",
                (pinned, session_id),
            )
            return cur.rowcount > 0
