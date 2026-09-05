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
from mcp.client import Transport
from mcp.client.sse import sse_client
from mcp.client.stdio import get_default_environment
from mcp.client.streamable_http import streamable_http_client

# Private module, and knowingly so: create_mcp_http_client has no public alias
# in mcp 2.1.1, and it is what streamable_http_client's own docstring points to
# for setting headers. Pinned in requirements.txt, so this cannot shift under us
# without a deliberate bump; the tests below fail loudly if it moves.
from mcp.shared._httpx_utils import create_mcp_http_client

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


def remote_transport(server: McpServerRow, headers: dict[str, str]) -> Transport:
    """A configured transport for sse/http, so headers actually reach the wire.

    `Client` accepts a bare URL string, but it has no `headers` argument: a URL
    resolves to `streamable_http_client(url)` with no way to attach auth, which
    is why a configured `headers` map used to be stored, shown in the editor,
    and then silently dropped. Building the transport here is the SDK's own
    answer — the two functions take headers by different routes, so both are
    spelled out rather than hidden behind a shared helper.
    """
    if not server.url:
        raise McpConfigError(
            f"{server.name}: {server.transport} server has no url configured"
        )

    if server.transport == "sse":
        # sse_client takes headers directly.
        return sse_client(server.url, headers=headers or None)

    # streamable_http_client has no headers argument; per its docstring the way
    # to set them is to hand it a pre-configured client.
    return streamable_http_client(
        server.url,
        http_client=create_mcp_http_client(headers=headers or None),
    )


def connection_target(
    server: McpServerRow,
    *,
    extra_headers: dict[str, str] | None = None,
) -> StdioServerParameters | Transport:
    """What to hand the mcp Client: params for stdio, a transport for the rest.

    `extra_headers` (a token resolved from the credential vault) wins over the
    row's own `headers`, so a stale value pasted into the editor cannot shadow
    the vault — the linked credential is the more authoritative of the two.
    """
    if server.transport == "stdio":
        return stdio_params(server)

    return remote_transport(server, {**server.headers, **(extra_headers or {})})
