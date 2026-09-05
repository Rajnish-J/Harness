"""Tool discovery for configured MCP servers.

Feeds the /tools page and the chat composer's tool picker. Kept in its own
router rather than bolted onto workflows.py because MCP is a chat concern.

Unlike the workflow routes this does not 503 on a missing DATABASE_URL: under
MOCK_MCP there is nothing to look up, and with real servers an empty list plus a
notice is more useful than an error page.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel

from app.core.config import Settings, get_settings
from app.db.registry_repo import get_enabled_mcp_servers
from app.mcp import resolve_mcp_tools
from app.mcp.credentials import resolve_auth
from app.models.workflow_api import ToolInfo

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["mcp"])


class McpTestResult(BaseModel):
    ok: bool
    error: str | None = None
    tool_count: int = 0


@router.get("/mcp/tools")
async def list_mcp_tools(
    request: Request,
    server_ids: str = Query(
        default="",
        description="Comma-separated mcp_servers ids. Empty means none.",
    ),
    settings: Settings = Depends(get_settings),
) -> dict[str, object]:
    """Discovered tools for the given servers, plus notices for any that failed.

    Notices are data, not errors: a server being down is a normal condition the
    UI should show next to the tools that did resolve.
    """
    ids = [part.strip() for part in server_ids.split(",") if part.strip()]

    tools, notices = await resolve_mcp_tools(request.app, settings, ids)

    return {
        "tools": [
            ToolInfo(
                name=tool.name,
                description=tool.description,
                input_schema=tool.input_schema,
                group=tool.group,
            ).model_dump()
            for tool in tools
        ],
        "notices": notices,
        "mock": settings.mock_mcp,
    }


@router.post("/mcp/{server_id}/test")
async def test_mcp_server(
    server_id: str,
    request: Request,
    settings: Settings = Depends(get_settings),
) -> McpTestResult:
    """Connect to one server right now, bypassing the failure cooldown.

    Mirrors POST /api/credentials/{id}/test: a connection that fails is a 200
    with `ok: false`, not an HTTP error -- that is the verdict the UI wants to
    show and let the operator act on, not a broken request. Only being unable
    to *perform* the check -- no database, unknown or disabled server -- is an
    error status.
    """
    manager = getattr(request.app.state, "mcp", None)
    if manager is None:
        raise HTTPException(status_code=503, detail="MCP is not configured.")

    pool = getattr(request.app.state, "pool", None)
    if pool is None:
        if settings.mock_mcp:
            # Nothing to look up under mock, same posture as resolve_mcp_tools.
            return McpTestResult(ok=True, tool_count=0)
        raise HTTPException(
            status_code=503,
            detail="DATABASE_URL is not configured, so MCP servers cannot be read.",
        )

    servers = await get_enabled_mcp_servers(pool, [server_id])
    if not servers:
        raise HTTPException(
            status_code=404, detail="MCP server not found, or not enabled."
        )
    server = servers[0]

    auth = await resolve_auth(pool, settings, server)
    ok, error, tool_count = await manager.test_connection(server, auth)

    if auth.notice and not error:
        error = auth.notice

    return McpTestResult(ok=ok, error=error, tool_count=tool_count)
