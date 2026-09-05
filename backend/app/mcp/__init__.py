"""MCP client integration.

The one entry point the chat route needs is `resolve_mcp_tools`. Everything that
can go wrong comes back as a notice string rather than an exception: the
contract is that attaching a broken MCP server degrades a chat turn to the
built-in tools, never fails it.
"""

import logging
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from app.agent.tools.base import Tool
from app.core.config import Settings
from app.db.registry_repo import (
    McpServerRow,
    get_enabled_mcp_servers,
    list_enabled_mcp_servers,
)
from app.mcp.credentials import resolve_auth

logger = logging.getLogger(__name__)

NO_DATABASE_NOTICE = (
    "MCP servers are configured in Postgres, but this backend has no "
    "DATABASE_URL set. Continuing with the built-in tools."
)


def _synthetic_rows(server_ids: list[str]) -> list[McpServerRow]:
    """Stand-in rows for MOCK_MCP when there is no database to read.

    Mock mode exists so the UI can be worked on with no infrastructure running.
    Requiring Postgres to hand back fake tools would defeat the entire point, so
    the ids are taken at face value and named after themselves.
    """
    rows: list[McpServerRow] = []
    for raw in server_ids:
        try:
            ident = UUID(raw)
        except ValueError:
            continue
        rows.append(
            McpServerRow(
                id=ident,
                name=f"mock-{raw[:8]}",
                transport="stdio",
                command="mock",
                args=[],
                url=None,
                env={},
                headers={},
                credential_id=None,
                enabled=True,
                updated_at=datetime.now(UTC),
            )
        )
    return rows


async def resolve_mcp_tools(
    app: Any,
    settings: Settings,
    server_ids: list[str],
) -> tuple[list[Tool], list[str]]:
    """Tools for the servers attached to this turn, plus any failure notices."""
    manager = getattr(app.state, "mcp", None)
    if manager is None:
        return [], []

    attach_all = settings.mcp_attach_all_enabled and not server_ids
    if not server_ids and not attach_all:
        return [], []

    pool = getattr(app.state, "pool", None)

    if pool is None:
        # Under MOCK_MCP there is nothing real to look up, so a missing database
        # is not a problem — fabricate the rows and carry on.
        if settings.mock_mcp:
            return await manager.tools_for(_synthetic_rows(server_ids))

        # Chat is designed to run without a database. Say so once and continue,
        # rather than turning an optional feature into a hard failure.
        return [], [NO_DATABASE_NOTICE]

    try:
        servers = (
            await list_enabled_mcp_servers(pool)
            if attach_all
            else await get_enabled_mcp_servers(pool, server_ids)
        )
    except Exception as exc:  # noqa: BLE001 - a read failure is not a chat failure
        logger.warning("Could not read mcp_servers: %s", exc)
        return [], [f"Could not read the MCP server list: {exc}"]

    if not servers:
        return [], []

    # Credentials are resolved here rather than inside the manager: decrypting
    # one needs the pool, and McpManager deliberately holds no database handle.
    # A server with no linked credential resolves to empty headers and costs
    # nothing.
    auth_by_id = {
        str(server.id): await resolve_auth(pool, settings, server)
        for server in servers
    }

    return await manager.tools_for(servers, auth_by_id)
