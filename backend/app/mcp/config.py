"""Turn a stored MCP server row into something the mcp client can connect to.

Note this package is `app.mcp` and the SDK is the top-level `mcp`. Python 3
imports are absolute, so `from mcp import Client` below resolves to the
installed SDK, not to this package.
"""

import asyncio
import logging
import shutil
import sys

from mcp import StdioServerParameters
from mcp.client.stdio import get_default_environment

from app.db.registry_repo import McpServerRow

logger = logging.getLogger(__name__)


class McpConfigError(Exception):
    """A server row cannot be turned into a usable connection."""


def resolve_command(command: str) -> str:
    """Find the executable, coping with Windows shims.

    `npx` and `uvx` are `.cmd` files on Windows, and CreateProcess will not find
    a bare `npx` — it surfaces as a raw WinError 2 that says nothing useful.
    Resolving here means the operator gets the actual problem instead.
    """
    found = shutil.which(command)
    if found:
        return found

    if sys.platform == "win32":
        for ext in (".cmd", ".exe", ".bat"):
            found = shutil.which(command + ext)
            if found:
                return found

    raise McpConfigError(f"command not found on PATH: {command}")


def assert_stdio_supported() -> None:
    """Fail legibly when the running loop cannot spawn subprocesses.

    Windows has a genuine conflict here and it is worth naming: psycopg's async
    pool refuses to run on ProactorEventLoop, while asyncio can only spawn
    subprocesses ON ProactorEventLoop. A process cannot have both, so a backend
    tuned to make Postgres work will fail to launch stdio MCP servers.

    Without this check that surfaces as a bare NotImplementedError from deep
    inside the SDK, which tells the operator nothing about the actual choice
    they are facing. Remote transports (sse, http) are unaffected either way.
    """
    if sys.platform != "win32":
        return

    loop = asyncio.get_running_loop()
    if isinstance(loop, asyncio.SelectorEventLoop):
        raise McpConfigError(
            "stdio MCP servers need a ProactorEventLoop, but this process is "
            "running a SelectorEventLoop (which psycopg's async pool requires "
            "on Windows). Use an sse or http MCP server here, or run the "
            "backend without DATABASE_URL."
        )


def stdio_params(server: McpServerRow) -> StdioServerParameters:
    assert_stdio_supported()

    if not server.command:
        raise McpConfigError(f"{server.name}: stdio server has no command configured")

    return StdioServerParameters(
        command=resolve_command(server.command),
        args=list(server.args),
        # The row's env is the contract. get_default_environment() is the SDK's
        # curated safe subset; passing os.environ wholesale would leak every
        # secret this process holds into a child process.
        env={**get_default_environment(), **server.env},
    )


def connection_target(server: McpServerRow) -> StdioServerParameters | str:
    """What to hand the mcp Client: params for stdio, a URL for the rest."""
    if server.transport == "stdio":
        return stdio_params(server)

    if not server.url:
        raise McpConfigError(
            f"{server.name}: {server.transport} server has no url configured"
        )
    return server.url
