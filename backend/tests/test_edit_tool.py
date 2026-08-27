import pytest

from app.agent.llm.base import ToolCallRequest
from app.agent.loop import _dispatch_tool
from app.agent.tools.registry import ALL_TOOLS
from app.core.config import get_settings

TOOLS_BY_NAME = {tool.name: tool for tool in ALL_TOOLS}


@pytest.fixture
def settings(tmp_path):
    return get_settings().model_copy(update={"workspace_root": tmp_path})


async def dispatch(name, arguments, settings):
    return await _dispatch_tool(
        ToolCallRequest(id="c1", name=name, arguments=arguments), settings, TOOLS_BY_NAME
    )


async def test_edit_not_found_is_an_error(settings, tmp_path):
    (tmp_path / "a.txt").write_text("hello world", encoding="utf-8")

    result = await dispatch(
        "edit_file",
        {"path": "a.txt", "old_string": "missing", "new_string": "x"},
        settings,
    )

    assert result.is_error
    assert "not found" in result.content


async def test_edit_ambiguous_without_replace_all_is_an_error(settings, tmp_path):
    (tmp_path / "a.txt").write_text("foo foo foo", encoding="utf-8")

    result = await dispatch(
        "edit_file",
        {"path": "a.txt", "old_string": "foo", "new_string": "bar"},
        settings,
    )

    assert result.is_error
    assert "3 times" in result.content
    assert (tmp_path / "a.txt").read_text(encoding="utf-8") == "foo foo foo"


async def test_edit_single_match_replaces(settings, tmp_path):
    (tmp_path / "a.txt").write_text("hello world", encoding="utf-8")

    result = await dispatch(
        "edit_file",
        {"path": "a.txt", "old_string": "world", "new_string": "there"},
        settings,
    )

    assert not result.is_error
    assert (tmp_path / "a.txt").read_text(encoding="utf-8") == "hello there"


async def test_edit_replace_all(settings, tmp_path):
    (tmp_path / "a.txt").write_text("foo foo foo", encoding="utf-8")

    result = await dispatch(
        "edit_file",
        {
            "path": "a.txt",
            "old_string": "foo",
            "new_string": "bar",
            "replace_all": True,
        },
        settings,
    )

    assert not result.is_error
    assert (tmp_path / "a.txt").read_text(encoding="utf-8") == "bar bar bar"


async def test_edit_sandbox_escape_refused(settings, tmp_path):
    result = await dispatch(
        "edit_file",
        {"path": "../outside.txt", "old_string": "a", "new_string": "b"},
        settings,
    )

    assert result.is_error
    assert "escapes the workspace sandbox" in result.content
