"""Tool discovery for configured MCP servers.

Feeds the /tools page and the chat composer's tool picker. Kept in its own
router rather than bolted onto workflows.py because MCP is a chat concern.

Unlike the workflow routes this does not 503 on a missing DATABASE_URL: under
MOCK_MCP there is nothing to look up, and with real servers an empty list plus a
notice is more useful than an error page.
"""

import logging

from fastapi import APIRouter, Depends, Query, Request

from app.core.config import Settings, get_settings
from app.mcp import resolve_mcp_tools
from app.models.workflow_api import ToolInfo

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["mcp"])


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
            ).model_dump()
            for tool in tools
        ],
        "notices": notices,
        "mock": settings.mock_mcp,
    }
