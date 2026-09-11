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
    get_mcp_servers,
    list_enabled_mcp_servers,
)
from app.db import tool_index_repo
from app.mcp.credentials import resolve_auth
from app.mcp.manager import McpNotice
from app.mcp.tools import mcp_group

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
    include_disabled: bool = False,
) -> tuple[list[Tool], list[McpNotice]]:
    """Tools for the servers attached to this turn, plus any failure notices.

    `include_disabled` is for the /tools page alone, which reports what every
    configured server offers and must not make a disabled one look empty. It
    defaults to False so every existing caller -- the chat path above all --
    keeps reaching only servers that are switched on. Turning it on is a
    preview: these tools are listed, never attached to a turn.
    """
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
        return [], [McpNotice(message=NO_DATABASE_NOTICE)]

    try:
        if attach_all:
            servers = await list_enabled_mcp_servers(pool)
        elif include_disabled:
            servers = await get_mcp_servers(pool, server_ids)
        else:
            servers = await get_enabled_mcp_servers(pool, server_ids)
    except Exception as exc:  # noqa: BLE001 - a read failure is not a chat failure
        logger.warning("Could not read mcp_servers: %s", exc)
        return [], [McpNotice(message=f"Could not read the MCP server list: {exc}")]

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

    tools, notices = await manager.tools_for(servers, auth_by_id)

    # Record what each server just said it offers. Here rather than in the
    # manager for the same reason credentials are resolved here: indexing
    # needs the pool, and McpManager deliberately holds no database handle.
    #
    # Every successful connection refreshes it, so the index is
    # self-healing: editing a server or rotating its credential misses the
    # manager cache, reconnects, and lands back here with the current list.
    await index_server_tools(pool, servers, tools)

    return tools, notices


async def index_server_tools(
    pool: Any,
    servers: list[Any],
    tools: list[Tool],
) -> None:
    """Persist each connected server's tools, so routing can skip the model.

    Best-effort and never raised: a turn that works must not fail because an
    optimisation could not be written down. A miss here costs one routing call,
    which is exactly what the code did before this existed.

    Only servers that actually answered are touched. A server that failed to
    connect contributes no tools, and blanking its rows on a transient outage
    would throw away a good index for a bad minute.
    """
    if pool is None or not servers:
        return

    # Imported here, not at module scope: app.agent.tools.router imports
    # app.mcp.tools, so a top-level import back into the router closes a
    # cycle and breaks the app at boot.
    from app.agent.tools.router import first_sentence

    by_group: dict[str, list[Tool]] = {}
    for tool in tools:
        by_group.setdefault(tool.group, []).append(tool)

    for server in servers:
        group = mcp_group(server.name)
        offered = by_group.get(group, [])
        if not offered:
            continue
        rows = [
            tool_index_repo.ToolIndexRow(
                # The server's own name, recovered from the namespaced one.
                # This is the upsert key, and it is what makes a rename an
                # update rather than a duplicate set of rows.
                raw_name=tool.name.split("__", 2)[-1],
                tool_name=tool.name,
                description=first_sentence(tool.description),
                group=tool.group,
                keywords=tool_index_repo.keywords_for(
                    tool.name, first_sentence(tool.description), [server.name]
                ),
                server_id=str(server.id),
            )
            for tool in offered
        ]
        try:
            await tool_index_repo.replace_for_server(pool, str(server.id), rows)
        except Exception:  # noqa: BLE001 - an index write is never fatal
            logger.exception("could not index tools for MCP server %s", server.name)

async def discover_candidate_tools(
    app: Any,
    settings: Settings,
    attached_ids: list[str],
    exclude_ids: set[str] | None = None,
) -> tuple[list[Tool], dict[str, str]]:
    """What the *unattached* enabled servers offer, for the router to see.

    Registering a server on /mcp reads as "the harness can do this now", but
    until someone also attaches it in the composer it contributes nothing --
    the model is never told the server exists, so it apologises for a
    capability the user already set up. These tools close that gap by reaching
    the router's catalog.

    They are NOT executable. Nothing here goes into the turn's toolset; the
    router may only name one to say "this task needs that server", which parks
    the turn on a consent card. Using someone's credentialed server is not a
    thing to do because a routing model guessed -- see app/agent/tools/router.py.

    Returns `(tools, server_name_by_id)`. The map is what the consent card needs
    to offer a server by name and attach it by id.

    Failures are swallowed entirely: an unreachable candidate must not add a
    notice to a turn that was never going to use it, and must never fail the
    turn. Same posture as the rest of this module, one degree quieter.
    """
    manager = getattr(app.state, "mcp", None)
    pool = getattr(app.state, "pool", None)
    if manager is None or pool is None:
        return [], {}

    try:
        servers = await list_enabled_mcp_servers(pool)
    except Exception as exc:  # noqa: BLE001 - a read failure is not a chat failure
        logger.warning("Could not read mcp_servers for candidates: %s", exc)
        return [], {}

    skip = {str(ident) for ident in attached_ids} | {
        str(ident) for ident in (exclude_ids or set())
    }
    candidates = [server for server in servers if str(server.id) not in skip]
    if not candidates:
        return [], {}

    auth_by_id = {
        str(server.id): await resolve_auth(pool, settings, server)
        for server in candidates
    }

    # Notices are dropped on purpose: see the docstring. A candidate that will
    # not start simply offers nothing.
    tools, _notices = await manager.tools_for(candidates, auth_by_id)
    return tools, {server.name: str(server.id) for server in candidates}
