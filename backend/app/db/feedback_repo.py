"""Was that reply any good? One vote per assistant message.

Same rules as the other repos: `%s` placeholders only, no DDL (Drizzle owns
`message_feedback`, in frontend/db/schema.ts).

Keyed on `message_uid` -- the harness's own id for an assistant message, minted
in the agent loop and stored on the message row -- rather than on `(session_id,
seq)`. The browser numbers a live transcript with a render-time counter and a
reloaded one by `seq`, so neither survives a refresh as a key; the uid is the
one name both paths agree on.

Deliberately NOT joined to `project_chat_messages` by a foreign key: those rows
belong to the chat repo and `clear_session` removes them outright, so a
reference would either block that or quietly take votes with it. A vote whose
message is gone is simply unreachable, which is the same thing a dangling
memory `session_id` already is elsewhere.

There is no auth in this app -- api/chat.py's header puts the boundary at
"whoever can reach this port" -- so "the user" is singular and one vote per
message is the whole model. No per-user column, because there is no per-user
anything to key it on.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID

from psycopg_pool import AsyncConnectionPool

logger = logging.getLogger(__name__)

#: Mirrors the `feedback_vote` Postgres enum in frontend/db/schema.ts.
VALID_VOTES = ("up", "down")

_COLUMNS = """
    id, session_id, message_uid, vote, note, memory_id, created_at, updated_at
"""


@dataclass
class FeedbackRow:
    id: UUID
    session_id: str
    message_uid: str
    vote: str
    #: What the user typed behind a thumbs-down. None means they voted and said
    #: nothing, which is a complete answer rather than a half-finished one.
    note: str | None
    #: The memory that note produced, when one was written.
    memory_id: UUID | None
    created_at: datetime
    updated_at: datetime


def _row(record: dict[str, Any]) -> FeedbackRow:
    return FeedbackRow(
        id=record["id"],
        session_id=record["session_id"],
        message_uid=record["message_uid"],
        vote=record["vote"],
        note=record["note"],
        memory_id=record["memory_id"],
        created_at=record["created_at"],
        updated_at=record["updated_at"],
    )


async def set_vote(
    pool: AsyncConnectionPool,
    *,
    session_id: str,
    message_uid: str,
    vote: str,
) -> FeedbackRow:
    """Record (or change) the vote on one message.

    `note` is deliberately left alone by the update. Switching thumbs-down ->
    thumbs-up -> thumbs-down again must not silently discard what the user
    wrote the first time; the note belongs to the message, not to whichever
    vote happens to be current.
    """
    async with pool.connection() as conn, conn.cursor() as cur:
        await cur.execute(
            f"""
            insert into message_feedback (session_id, message_uid, vote)
            values (%s, %s, %s)
            on conflict (message_uid) do update set
                vote       = excluded.vote,
                updated_at = now()
            returning {_COLUMNS}
            """,  # noqa: S608 - _COLUMNS is a fixed literal, never user input
            (session_id, message_uid, vote),
        )
        record = await cur.fetchone()

    assert record is not None, "insert ... returning always yields a row"
    return _row(record)


async def clear_vote(pool: AsyncConnectionPool, message_uid: str) -> bool:
    """Retract the vote on one message. False when there was none.

    A removal rather than a third enum value: "never voted" and "voted, then
    thought better of it" are the same fact to everything that reads this, and
    a `neutral` value would leave every caller to collapse the two anyway.

    The note goes with it, which is the one asymmetry worth knowing about: the
    memory that note produced is a separate row and survives. Retracting a
    thumb does not un-say what the user typed, and removing that memory is done
    on the memory page, where the user can see what they are removing.
    """
    async with pool.connection() as conn, conn.cursor() as cur:
        await cur.execute(
            "delete from message_feedback where message_uid = %s",
            (message_uid,),
        )
        return cur.rowcount > 0


async def attach_note(
    pool: AsyncConnectionPool,
    *,
    message_uid: str,
    note: str,
    memory_id: str | None,
) -> FeedbackRow | None:
    """Record the note behind a thumbs-down, and the memory it produced.

    None when there is no vote to attach to. The route votes before it asks for
    a note, so that means the vote was retracted in between -- rare, and not
    worth resurrecting a row the user has just dismissed.
    """
    async with pool.connection() as conn, conn.cursor() as cur:
        await cur.execute(
            f"""
            update message_feedback
               set note = %s, memory_id = %s, updated_at = now()
             where message_uid = %s
            returning {_COLUMNS}
            """,  # noqa: S608 - _COLUMNS is a fixed literal, never user input
            (note, memory_id, message_uid),
        )
        record = await cur.fetchone()

    return _row(record) if record is not None else None


async def list_for_session(
    pool: AsyncConnectionPool, session_id: str
) -> list[FeedbackRow]:
    """Every vote in one conversation, so a reload repaints them.

    Ordered by message rather than by time: the caller keys these by
    `message_uid` to paint each row, and a stable order keeps the result
    comparable between calls.
    """
    async with pool.connection() as conn, conn.cursor() as cur:
        await cur.execute(
            f"select {_COLUMNS} from message_feedback "  # noqa: S608 - fixed literal
            "where session_id = %s order by message_uid",
            (session_id,),
        )
        return [_row(record) for record in await cur.fetchall()]
