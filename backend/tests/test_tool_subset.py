"""A node's tool subset must gate DISPATCH, not merely the advertised schemas.

If it only filtered what the model is told about, a hallucinated tool name would
still execute — which for `write_file` on a read-only node means real writes.
"""

import pytest

from app.agent.llm.base import ToolCallRequest
from app.agent.loop import _dispatch_tool
from app.agent.tools.registry import ALL_TOOLS, TOOLS_BY_NAME
from app.core.config import get_settings
from app.workflow.toolsets import UnknownToolError, resolve_toolset


@pytest.fixture
def settings(tmp_path):
    return get_settings().model_copy(update={"workspace_root": tmp_path})


async def dispatch(name, arguments, tools):
    by_name = {t.name: t for t in tools}
    return await _dispatch_tool(
        ToolCallRequest(id="c1", name=name, arguments=arguments), settings_for(), by_name
    )


def settings_for():
    return get_settings()


@pytest.mark.asyncio
async def test_tool_outside_subset_is_refused(settings, tmp_path):
    read_only = resolve_toolset(["read_file"])
    by_name = {t.name: t for t in read_only}

    result = await _dispatch_tool(
        ToolCallRequest(
            id="c1", name="write_file",
            arguments={"path": "pwned.txt", "content": "should never exist"},
        ),
        settings,
        by_name,
    )

    assert result.is_error
    assert "Unknown tool 'write_file'" in result.content
    # The refusal names only what this node may use, so the model can recover.
    assert "read_file" in result.content
    assert "write_file" not in result.content.split("Available tools:")[1]
    # And nothing was written.
    assert not (tmp_path / "pwned.txt").exists()


@pytest.mark.asyncio
async def test_tool_inside_subset_runs(settings, tmp_path):
    (tmp_path / "note.txt").write_text("hello", encoding="utf-8")
    read_only = resolve_toolset(["read_file"])
    by_name = {t.name: t for t in read_only}

    result = await _dispatch_tool(
        ToolCallRequest(id="c1", name="read_file", arguments={"path": "note.txt"}),
        settings,
        by_name,
    )
    assert not result.is_error
    assert result.content == "hello"


@pytest.mark.asyncio
async def test_default_full_registry_still_works(settings, tmp_path):
    by_name = {t.name: t for t in ALL_TOOLS}
    result = await _dispatch_tool(
        ToolCallRequest(
            id="c1", name="write_file",
            arguments={"path": "ok.txt", "content": "fine"},
        ),
        settings,
        by_name,
    )
    assert not result.is_error
    assert (tmp_path / "ok.txt").read_text() == "fine"


def test_resolve_toolset_none_means_everything():
    assert resolve_toolset(None) == ALL_TOOLS
    assert resolve_toolset([]) == ALL_TOOLS


def test_resolve_toolset_preserves_registry_order():
    # Requested in reverse; must come back in ALL_TOOLS order so the prompt
    # prefix stays cacheable.
    names = [t.name for t in ALL_TOOLS]
    resolved = resolve_toolset(list(reversed(names)))
    assert [t.name for t in resolved] == names


def test_resolve_toolset_rejects_unknown():
    with pytest.raises(UnknownToolError):
        resolve_toolset(["read_file", "rm_rf"])


def test_registry_is_consistent():
    assert set(TOOLS_BY_NAME) == {t.name for t in ALL_TOOLS}
