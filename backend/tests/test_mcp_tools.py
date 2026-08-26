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


def server_row(name: str = "github") -> McpServerRow:
    return McpServerRow(
        id=uuid4(),
        name=name,
        transport="stdio",
        command="npx",
        args=[],
        url=None,
        env={},
        headers={},
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
        return Tool(name=name, description="", input_schema={}, run=lambda: "")

    out = dedupe([make("mcp__a__t"), make("mcp__a__t"), make("mcp__a__t")])
    assert [tool.name for tool in out] == [
        "mcp__a__t",
        "mcp__a__t_2",
        "mcp__a__t_3",
    ]


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
