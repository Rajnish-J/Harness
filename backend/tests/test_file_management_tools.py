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


async def test_delete_file_removes_it(settings, tmp_path):
    (tmp_path / "a.txt").write_text("hello", encoding="utf-8")

    result = await dispatch("delete_file", {"path": "a.txt"}, settings)

    assert not result.is_error
    assert not (tmp_path / "a.txt").exists()


async def test_delete_file_refuses_directory(settings, tmp_path):
    (tmp_path / "sub").mkdir()

    result = await dispatch("delete_file", {"path": "sub"}, settings)

    assert result.is_error
    assert (tmp_path / "sub").exists()


async def test_delete_file_sandbox_escape_refused(settings, tmp_path):
    result = await dispatch("delete_file", {"path": "../outside.txt"}, settings)

    assert result.is_error
    assert "escapes the workspace sandbox" in result.content


async def test_move_file_moves_it(settings, tmp_path):
    (tmp_path / "a.txt").write_text("hello", encoding="utf-8")

    result = await dispatch("move_file", {"src": "a.txt", "dest": "b.txt"}, settings)

    assert not result.is_error
    assert not (tmp_path / "a.txt").exists()
    assert (tmp_path / "b.txt").read_text(encoding="utf-8") == "hello"


async def test_move_file_refuses_overwrite_by_default(settings, tmp_path):
    (tmp_path / "a.txt").write_text("hello", encoding="utf-8")
    (tmp_path / "b.txt").write_text("existing", encoding="utf-8")

    result = await dispatch("move_file", {"src": "a.txt", "dest": "b.txt"}, settings)

    assert result.is_error
    assert (tmp_path / "b.txt").read_text(encoding="utf-8") == "existing"


async def test_move_file_overwrite_true_replaces(settings, tmp_path):
    (tmp_path / "a.txt").write_text("hello", encoding="utf-8")
    (tmp_path / "b.txt").write_text("existing", encoding="utf-8")

    result = await dispatch(
        "move_file", {"src": "a.txt", "dest": "b.txt", "overwrite": True}, settings
    )

    assert not result.is_error
    assert (tmp_path / "b.txt").read_text(encoding="utf-8") == "hello"


async def test_move_file_sandbox_escape_refused(settings, tmp_path):
    (tmp_path / "a.txt").write_text("hello", encoding="utf-8")

    result = await dispatch(
        "move_file", {"src": "a.txt", "dest": "../outside.txt"}, settings
    )

    assert result.is_error
    assert "escapes the workspace sandbox" in result.content


async def test_copy_file_duplicates_it(settings, tmp_path):
    (tmp_path / "a.txt").write_text("hello", encoding="utf-8")

    result = await dispatch("copy_file", {"src": "a.txt", "dest": "b.txt"}, settings)

    assert not result.is_error
    assert (tmp_path / "a.txt").read_text(encoding="utf-8") == "hello"
    assert (tmp_path / "b.txt").read_text(encoding="utf-8") == "hello"


async def test_copy_file_refuses_overwrite_by_default(settings, tmp_path):
    (tmp_path / "a.txt").write_text("hello", encoding="utf-8")
    (tmp_path / "b.txt").write_text("existing", encoding="utf-8")

    result = await dispatch("copy_file", {"src": "a.txt", "dest": "b.txt"}, settings)

    assert result.is_error
    assert (tmp_path / "b.txt").read_text(encoding="utf-8") == "existing"


async def test_copy_file_sandbox_escape_refused(settings, tmp_path):
    (tmp_path / "a.txt").write_text("hello", encoding="utf-8")

    result = await dispatch(
        "copy_file", {"src": "a.txt", "dest": "../outside.txt"}, settings
    )

    assert result.is_error
    assert "escapes the workspace sandbox" in result.content


async def test_make_directory_creates_it(settings, tmp_path):
    result = await dispatch("make_directory", {"path": "a/b/c"}, settings)

    assert not result.is_error
    assert (tmp_path / "a" / "b" / "c").is_dir()


async def test_make_directory_refuses_when_a_file_is_there(settings, tmp_path):
    (tmp_path / "a").write_text("hello", encoding="utf-8")

    result = await dispatch("make_directory", {"path": "a"}, settings)

    assert result.is_error


async def test_make_directory_sandbox_escape_refused(settings, tmp_path):
    result = await dispatch("make_directory", {"path": "../outside"}, settings)

    assert result.is_error
    assert "escapes the workspace sandbox" in result.content
