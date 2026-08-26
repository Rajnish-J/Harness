"""Fake MCP tool discovery, for MOCK_MCP=true.

Short-circuits at the manager boundary rather than inside a runner, so no
subprocess is ever spawned and no socket is ever opened. That makes this the way
to develop the composer on a machine with no Node installed, and the way CI can
exercise the tool-wrapping path without network access.

Fake tools are derived from the server's configured transport, so what you see
stays connected to the row you actually configured.
"""

import asyncio
import json
from typing import Any

from app.agent.tools.base import Tool
from app.db.registry_repo import McpServerRow
from app.mcp.tools import dedupe, namespaced

_STDIO_TOOLS = [
    ("list_directory", "List a directory through this server.", ["path"]),
    ("read_file", "Read a file through this server.", ["path"]),
]

_HTTP_TOOLS = [
    ("search", "Search this server's index.", ["query"]),
    ("fetch", "Fetch one record by id.", ["id"]),
]

_ALWAYS = [("ping", "Check that this server is responding.", [])]


def _spec(server: McpServerRow) -> list[tuple[str, str, list[str]]]:
    base = _STDIO_TOOLS if server.transport == "stdio" else _HTTP_TOOLS
    return [*base, *_ALWAYS]


def _make(server: McpServerRow, name: str, description: str, params: list[str]) -> Tool:
    schema: dict[str, Any] = {
        "type": "object",
        "properties": {p: {"type": "string"} for p in params},
        "required": params,
    }

    async def run(**kwargs: Any) -> str:
        kwargs.pop("workspace_root", None)
        kwargs.pop("max_file_bytes", None)
        # A little latency so the transcript shows the amber "running" dot flip
        # to green, rather than completing between frames.
        await asyncio.sleep(0.25)
        return (
            f"[mock {server.name}.{name}] called with "
            f"{json.dumps(kwargs, default=str)}"
        )

    return Tool(
        name=namespaced(server.name, name),
        description=f"[{server.name}] {description} (mock)",
        input_schema=schema,
        run=run,
    )


def mock_tools_for(servers: list[McpServerRow]) -> list[Tool]:
    tools: list[Tool] = []
    for server in servers:
        tools.extend(_make(server, *spec) for spec in _spec(server))
    return dedupe(tools)
