"""Read access to the Drizzle-owned registry tables.

Same two rules as workflow_repo.py, and they are enforced by tests:

1. Every value goes through a `%s` placeholder. Never an f-string, never
   concatenation — not even for values that "obviously" came from a UUID column.
   Note the id filter below uses `= any(%s)` with a list parameter rather than
   building an IN list, which is the same rule applied to a set of values.
2. This module emits no schema statements at all. Drizzle owns every application
   table; Python only ever reads them.

Only the MCP rows are read here. Agents and skills reach the chat as resolved
text in the request body — see the docstring on app/models/chat.py for why — so
Python never needs to look them up.
"""

import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID

from psycopg_pool import AsyncConnectionPool

logger = logging.getLogger(__name__)


@dataclass
class McpServerRow:
    id: UUID
    name: str
    transport: str
    command: str | None
    args: list[str]
    url: str | None
    env: dict[str, str]
    headers: dict[str, str]
    #: Optional link to an encrypted `credentials` row. Resolved to an
    #: Authorization header at connect time by app/mcp/credentials.py, so a
    #: remote server's PAT never has to be copied into `headers` in plaintext.
    credential_id: UUID | None
    enabled: bool
    #: Doubles as the connection cache fingerprint: editing a server bumps this,
    #: which misses the cache and forces a reconnect with the new settings.
    updated_at: datetime


_COLUMNS = """
    id, name, transport, command, args, url, env, headers, credential_id,
    enabled, updated_at
"""


def _row(record: dict[str, Any]) -> McpServerRow:
    return McpServerRow(
        id=record["id"],
        name=record["name"],
        transport=record["transport"],
        command=record["command"],
        args=list(record["args"] or []),
        url=record["url"],
        env=dict(record["env"] or {}),
        headers=dict(record["headers"] or {}),
        credential_id=record["credential_id"],
        enabled=record["enabled"],
        updated_at=record["updated_at"],
    )


async def get_enabled_mcp_servers(
    pool: AsyncConnectionPool, server_ids: list[str]
) -> list[McpServerRow]:
    """The enabled servers among the given ids, in the order the caller asked.

    Disabled rows are filtered in SQL rather than in Python so a server turned
    off in the UI can never be attached by a stale id held in a browser tab.
    """
    if not server_ids:
        return []

    async with pool.connection() as conn, conn.cursor() as cur:
        await cur.execute(
            f"select {_COLUMNS} from mcp_servers "  # noqa: S608 - no interpolated values
            "where id = any(%s) and enabled",
            (server_ids,),
        )
        records = await cur.fetchall()

    by_id = {str(record["id"]): _row(record) for record in records}
    return [by_id[sid] for sid in server_ids if sid in by_id]


async def list_enabled_mcp_servers(pool: AsyncConnectionPool) -> list[McpServerRow]:
    """Every enabled server. Only used when MCP_ATTACH_ALL_ENABLED is on."""
    async with pool.connection() as conn, conn.cursor() as cur:
        await cur.execute(
            f"select {_COLUMNS} from mcp_servers where enabled order by name"  # noqa: S608
        )
        return [_row(record) for record in await cur.fetchall()]
