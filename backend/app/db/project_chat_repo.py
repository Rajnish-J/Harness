"""Durable chat for a project.

Writes both chat tables. Same rules as the other repos -- `%s` placeholders
only, no DDL -- plus the split those two tables encode:

- ``project_chat_sessions`` is what the MODEL needs to continue: a
  provider-native message list, stored opaquely because it is Anthropic's or
  OpenAI's format and parsing it here would couple the schema to a vendor.
- ``project_chat_messages`` is what the PAGE needs to repaint: the rendered
  transcript, in the order it was shown.

Only project-scoped sessions come through here. The chat on `/` stays in memory
exactly as before, which is why `SessionStore` gained a hook rather than a
dependency on this module.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any, Sequence

from psycopg import sql as _sql  # noqa: F401  (kept for parity with other repos)
from psycopg.types.json import Json
from psycopg_pool import AsyncConnectionPool

logger = logging.getLogger(__name__)


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
    project_id: str,
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
    project_id: str,
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
