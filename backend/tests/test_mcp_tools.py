"""MCP tool wrapping: namespacing, kwarg stripping, and error propagation.

None of these need a server — the point is that the wrapper is correct before
any subprocess is involved.
"""

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

import pytest

from app.agent.tools.base import Tool, ToolExecutionError
from app.agent.tools.registry import ALL_TOOLS
from app.agent.tools.toolsets import merge_toolsets
from app.db.registry_repo import McpServerRow
from app.mcp.mock import mock_tools_for
from app.mcp.tools import dedupe, make_tool, namespaced


@dataclass
class FakeMcpTool:
    name: str
    description: str = ""
    inputSchema: dict[str, Any] | None = None  # noqa: N815 - mirrors the SDK


@dataclass
class FakeBlock:
    text: str


@dataclass
class FakeResult:
    content: list[Any]
    isError: bool = False  # noqa: N815 - mirrors the SDK


class FakeCaller:
    def __init__(self, result: Any) -> None:
        self.result = result
        self.calls: list[tuple[str, dict[str, Any]]] = []

    async def call(self, name: str, args: dict[str, Any]) -> Any:
        self.calls.append((name, args))
        return self.result


def server_row(
    name: str = "github",
    *,
    transport: str = "stdio",
    url: str | None = None,
    headers: dict[str, str] | None = None,
    credential_id: Any = None,
) -> McpServerRow:
    return McpServerRow(
        id=uuid4(),
        name=name,
        transport=transport,
        command="npx" if transport == "stdio" else None,
        args=[],
        url=url,
        env={},
        headers=headers or {},
        credential_id=credential_id,
        enabled=True,
        updated_at=datetime.now(UTC),
    )


def test_namespacing_prevents_shadowing_a_builtin():
    """A server's read_file must not be able to displace the real one."""
    name = namespaced("filesystem", "read_file")
    assert name == "mcp__filesystem__read_file"
    assert name not in {tool.name for tool in ALL_TOOLS}


def test_namespacing_sanitizes_and_bounds_the_name():
    name = namespaced("My Server!", "do/the@thing")
    assert name == "mcp__my_server__do_the_thing"
    assert len(namespaced("x" * 200, "y" * 200)) <= 128


@pytest.mark.asyncio
async def test_run_strips_the_kwargs_the_loop_injects():
    """The agent loop passes workspace_root and max_file_bytes to every tool."""
    caller = FakeCaller(FakeResult(content=[FakeBlock(text="ok")]))
    tool = make_tool("github", caller, FakeMcpTool(name="search"))

    out = await tool.run(query="bug", workspace_root="/tmp", max_file_bytes=1)

    assert out == "ok"
    assert caller.calls == [("search", {"query": "bug"})]


@pytest.mark.asyncio
async def test_is_error_becomes_a_recoverable_tool_error():
    caller = FakeCaller(FakeResult(content=[FakeBlock(text="boom")], isError=True))
    tool = make_tool("github", caller, FakeMcpTool(name="search"))

    with pytest.raises(ToolExecutionError, match="boom"):
        await tool.run(query="x")


def test_dedupe_suffixes_collisions():
    def make(name: str) -> Tool:
        return Tool(
            name=name, description="", input_schema={}, run=lambda: "", group="MCP · a"
        )

    out = dedupe([make("mcp__a__t"), make("mcp__a__t"), make("mcp__a__t")])
    assert [tool.name for tool in out] == [
        "mcp__a__t",
        "mcp__a__t_2",
        "mcp__a__t_3",
    ]
    # Renaming must carry every other field across. A field-by-field rebuild
    # here would silently drop whatever was added to Tool most recently.
    assert {tool.group for tool in out} == {"MCP · a"}


def test_wrapped_tools_carry_their_server_group():
    """The composer files each server's tools under their own section."""
    tool = make_tool(
        "github", FakeCaller(FakeResult(content=[])), FakeMcpTool(name="search")
    )

    assert tool.group == "MCP · github"


def test_mock_discovery_is_namespaced_and_transport_shaped():
    tools = mock_tools_for([server_row("filesystem")])
    names = {tool.name for tool in tools}

    assert "mcp__filesystem__list_directory" in names
    assert "mcp__filesystem__ping" in names
    assert all(name.startswith("mcp__filesystem__") for name in names)


def test_merge_keeps_builtins_first_and_mcp_sorted():
    mcp = mock_tools_for([server_row("zeta")])
    merged = merge_toolsets(None, mcp)

    assert merged[: len(ALL_TOOLS)] == ALL_TOOLS
    mcp_names = [tool.name for tool in merged[len(ALL_TOOLS) :]]
    assert mcp_names == sorted(mcp_names)


def test_merge_drops_mcp_names_whose_server_is_down():
    """An unreachable server must not turn a chat message into an error."""
    merged = merge_toolsets(["read_file", "mcp__github__search_issues"], [])

    assert [tool.name for tool in merged] == ["read_file"]


def test_merge_still_raises_on_an_unknown_builtin():
    from app.agent.tools.toolsets import UnknownToolError

    with pytest.raises(UnknownToolError):
        merge_toolsets(["rm_rf"], [])


def test_merge_falls_back_when_every_selected_tool_is_missing():
    """An allowlist of only-down MCP tools would leave the model nothing."""
    merged = merge_toolsets(["mcp__github__search_issues"], [])
    assert merged == ALL_TOOLS


# --------------------------------------------------------------- connection targets
#
# The bug these pin: `headers` was stored, shown in the editor, and then dropped
# on the floor, because Client accepts a bare URL and has no headers argument.


def test_stdio_still_gets_server_parameters(monkeypatch: pytest.MonkeyPatch) -> None:
    """The remote work must not disturb the subprocess path."""
    from mcp import StdioServerParameters

    from app.mcp.config import connection_target

    monkeypatch.setattr("app.mcp.config.assert_stdio_supported", lambda: None)
    monkeypatch.setattr("app.mcp.config.resolve_command", lambda command: command)

    target = connection_target(server_row(transport="stdio"))

    assert isinstance(target, StdioServerParameters)


def test_remote_headers_reach_the_transport(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.mcp.config import remote_transport

    seen: dict[str, Any] = {}
    monkeypatch.setattr(
        "app.mcp.config.create_mcp_http_client",
        lambda headers=None: seen.update(headers=headers) or "client",
    )
    monkeypatch.setattr(
        "app.mcp.config.streamable_http_client",
        lambda url, http_client=None: seen.update(url=url, client=http_client),
    )

    row = server_row(transport="http", url="https://example.com/mcp/")
    remote_transport(row, {"Authorization": "Bearer t"})

    assert seen["url"] == "https://example.com/mcp/"
    assert seen["headers"] == {"Authorization": "Bearer t"}
    assert seen["client"] == "client"


def test_sse_takes_headers_directly(monkeypatch: pytest.MonkeyPatch) -> None:
    """sse_client has a headers kwarg; streamable_http_client does not."""
    from app.mcp.config import remote_transport

    seen: dict[str, Any] = {}
    monkeypatch.setattr(
        "app.mcp.config.sse_client",
        lambda url, headers=None: seen.update(url=url, headers=headers),
    )

    row = server_row(transport="sse", url="http://localhost:8931/sse")
    remote_transport(row, {"Authorization": "Bearer t"})

    assert seen["headers"] == {"Authorization": "Bearer t"}


def test_a_resolved_credential_wins_over_a_pasted_header(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A stale value typed into the editor must not shadow the vault."""
    from app.mcp.config import connection_target

    seen: dict[str, Any] = {}
    monkeypatch.setattr(
        "app.mcp.config.create_mcp_http_client",
        lambda headers=None: seen.update(headers=headers),
    )
    monkeypatch.setattr(
        "app.mcp.config.streamable_http_client", lambda url, http_client=None: None
    )

    row = server_row(
        transport="http",
        url="https://example.com/mcp/",
        headers={"Authorization": "Bearer stale", "X-Trace": "keep"},
    )
    connection_target(row, extra_headers={"Authorization": "Bearer fresh"})

    assert seen["headers"]["Authorization"] == "Bearer fresh"
    # Unrelated headers survive the merge.
    assert seen["headers"]["X-Trace"] == "keep"


def test_a_remote_server_without_a_url_is_refused() -> None:
    from app.mcp.config import McpConfigError, connection_target

    with pytest.raises(McpConfigError, match="no url configured"):
        connection_target(server_row(transport="http", url=None))


def test_rotating_a_token_invalidates_the_cached_connection() -> None:
    """A rotated PAT must force a reconnect.

    Rotating a token writes to `credentials`, not `mcp_servers`, so updated_at
    alone would keep a live runner replaying the old bearer token until the
    process restarted.
    """
    from app.core.config import Settings
    from app.mcp.manager import McpManager

    manager = McpManager(Settings())
    row = server_row(transport="http", url="https://example.com/mcp/")

    assert manager._key(row, "cred:1234") != manager._key(row, "cred:9999")
    # Same token, same row: the connection is still reusable.
    assert manager._key(row, "cred:1234") == manager._key(row, "cred:1234")
    # The server id stays the first element, which is what the stale-runner
    # sweep in _runner_for matches on.
    assert manager._key(row, "cred:1234")[0] == str(row.id)


def test_the_sdk_still_exposes_what_the_remote_path_imports() -> None:
    """A canary on mcp==2.1.1's shape.

    connection_target reaches into `mcp.shared._httpx_utils` because
    `create_mcp_http_client` has no public alias and is what
    streamable_http_client's docstring names for setting headers. If a version
    bump moves or renames it, this fails here with an obvious cause instead of
    surfacing as MCP servers that mysteriously stop authenticating.
    """
    import inspect

    from mcp.client import Transport  # noqa: F401 - the public re-export
    from mcp.shared._httpx_utils import create_mcp_http_client
    from mcp.client.sse import sse_client
    from mcp.client.streamable_http import streamable_http_client

    assert "headers" in inspect.signature(create_mcp_http_client).parameters
    assert "headers" in inspect.signature(sse_client).parameters
    # The reason we cannot just pass headers to streamable_http_client.
    http_params = inspect.signature(streamable_http_client).parameters
    assert "headers" not in http_params
    assert "http_client" in http_params
