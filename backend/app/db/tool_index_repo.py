"""Every tool the harness knows, kept where choosing one costs nothing.

Same rules as the other repos: `%s` placeholders only, no DDL (Drizzle owns
`tool_index`, in frontend/db/schema.ts).

The point of this table is a cost one. The router explains the whole catalog to
a model on every message -- ~2,900 tokens with a couple of MCP servers
connected, spent before the first token of the answer comes back. The same
question answered against rows costs nothing billable: the comparison happens
here and in Python, and none of it is ever put in a prompt.

Two kinds of row, one table:

- ``server_id IS NULL`` is a harness built-in (read_file, git_commit, ...).
  Static, indexed once at startup from ALL_TOOLS.
- ``server_id`` set is an MCP server's tool, re-indexed every time the harness
  connects to that server successfully.

Keyed on ``(server_id, raw_name)`` rather than the namespaced name, because
`mcp__{server}__{tool}` is built from the server's NAME (see `namespaced` in
app/mcp/tools.py) -- so renaming a server changes every namespaced name it
owns. Keying on the raw name turns a rename into an UPDATE of `tool_name`
rather than a set of orphaned rows plus a duplicate insert.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Any, Sequence

from psycopg.types.json import Json
from psycopg_pool import AsyncConnectionPool

logger = logging.getLogger(__name__)

_COLUMNS = """
    id, server_id, raw_name, tool_name, description, "group", keywords,
    updated_at
"""

#: Words that match everything and therefore distinguish nothing. Hand-picked
#: rather than a library list: these are the ones that actually show up in tool
#: descriptions ("Read a file FROM THE workspace AND return ITS contents"), and
#: a broader list would start eating real terms like "get".
_STOPWORDS = frozenset(
    """
    a an and any are as at be by can for from get has have in into is it its
    of on or that the their them then there these this to use used uses using
    was were what when which will with without you your
    """.split()
)

#: Below this a term is noise -- "to", "id", "up".
_MIN_KEYWORD_LEN = 3

_WORD_RE = re.compile(r"[^a-z0-9]+")


def keywords_for(name: str, description: str, extra: Sequence[str] = ()) -> list[str]:
    """The terms a tool should match on, derived from what it already carries.

    Derived rather than hand-written, so a newly added tool -- or a newly
    connected MCP server -- is searchable without anyone maintaining a list.
    The name matters more than the prose: `search_repositories` yields
    "search" and "repositories", which is most of what a user's phrasing will
    actually contain.

    `extra` carries anything else worth matching, such as an MCP server's own
    name, so "github" finds that server's tools even when no individual tool
    mentions it.

    Sorted and de-duplicated: this is stored, compared and diffed, and a stable
    order keeps an unchanged tool from looking changed.
    """
    words: set[str] = set()
    for source in (name, description, *extra):
        for word in _WORD_RE.split((source or "").lower()):
            if len(word) >= _MIN_KEYWORD_LEN and word not in _STOPWORDS:
                words.add(word)
    # "mcp" is on every namespaced tool, so it separates nothing.
    words.discard("mcp")
    return sorted(words)


@dataclass
class ToolIndexRow:
    """One indexed tool. Mirrors the columns, plus nothing."""

    raw_name: str
    tool_name: str
    description: str
    group: str
    keywords: list[str] = field(default_factory=list)
    #: None for a harness built-in.
    server_id: str | None = None


def _row(record: dict[str, Any]) -> ToolIndexRow:
    keywords = record["keywords"]
    return ToolIndexRow(
        raw_name=record["raw_name"],
        tool_name=record["tool_name"],
        description=record["description"],
        group=record["group"],
        keywords=list(keywords or []),
        server_id=str(record["server_id"]) if record["server_id"] else None,
    )


_INSERT_SERVER = """
    insert into tool_index
        (server_id, raw_name, tool_name, description, "group", keywords,
         updated_at)
    values (%s, %s, %s, %s, %s, %s, now())
    on conflict (server_id, raw_name) do update set
        tool_name   = excluded.tool_name,
        description = excluded.description,
        "group"     = excluded."group",
        keywords    = excluded.keywords,
        updated_at  = now()
"""

_INSERT_BUILTIN = """
    insert into tool_index
        (server_id, raw_name, tool_name, description, "group", keywords,
         updated_at)
    values (null, %s, %s, %s, %s, %s, now())
    on conflict (raw_name) where server_id is null do update set
        tool_name   = excluded.tool_name,
        description = excluded.description,
        "group"     = excluded."group",
        keywords    = excluded.keywords,
        updated_at  = now()
"""


async def replace_for_server(
    pool: AsyncConnectionPool,
    server_id: str,
    rows: Sequence[ToolIndexRow],
) -> int:
    """Make the index match what this server just said it offers.

    A replace, not an append: a server that dropped a tool between connections
    must not go on offering it here, and an upsert alone cannot notice that.
    Both statements run in ONE transaction, so a turn reading concurrently
    never catches the server with none of its tools.
    """
    async with pool.connection() as conn, conn.transaction(), conn.cursor() as cur:
        if not rows:
            # The server answered with nothing. Recording that is right: it is
            # the difference between "offers no tools" and "never asked".
            await cur.execute(
                "delete from tool_index where server_id = %s", (server_id,)
            )
            return 0

        await cur.executemany(
            _INSERT_SERVER,
            [
                (
                    server_id,
                    row.raw_name,
                    row.tool_name,
                    row.description,
                    row.group,
                    Json(row.keywords),
                )
                for row in rows
            ],
        )
        await cur.execute(
            "delete from tool_index where server_id = %s and raw_name <> all(%s)",
            (server_id, [row.raw_name for row in rows]),
        )
    return len(rows)


async def replace_builtins(
    pool: AsyncConnectionPool, rows: Sequence[ToolIndexRow]
) -> int:
    """Same, for the harness's own tools -- the `server_id IS NULL` rows.

    A separate function rather than `replace_for_server(None, ...)` because
    NULL needs different SQL: `server_id = NULL` matches nothing, and the
    conflict target is the partial unique index rather than the constraint.
    """
    if not rows:
        return 0

    async with pool.connection() as conn, conn.transaction(), conn.cursor() as cur:
        await cur.executemany(
            _INSERT_BUILTIN,
            [
                (
                    row.raw_name,
                    row.tool_name,
                    row.description,
                    row.group,
                    Json(row.keywords),
                )
                for row in rows
            ],
        )
        await cur.execute(
            "delete from tool_index where server_id is null and raw_name <> all(%s)",
            ([row.raw_name for row in rows],),
        )
    return len(rows)


async def list_all(pool: AsyncConnectionPool) -> list[ToolIndexRow]:
    """Every indexed tool, built-ins and MCP alike.

    One query for both kinds: selection asks a single question -- "what can
    answer this?" -- and two queries plus a merge would buy nothing.
    """
    async with pool.connection() as conn, conn.cursor() as cur:
        await cur.execute(
            f"select {_COLUMNS} from tool_index "  # noqa: S608 - fixed literal
            'order by "group", tool_name'
        )
        return [_row(record) for record in await cur.fetchall()]
