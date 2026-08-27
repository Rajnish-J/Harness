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


async def test_search_files_finds_a_match(settings, tmp_path):
    (tmp_path / "a.py").write_text("def hello():\n    return 42\n", encoding="utf-8")

    result = await dispatch("search_files", {"pattern": "def hello"}, settings)

    assert not result.is_error
    assert "a.py:1:" in result.content


async def test_search_files_respects_path_scoping(settings, tmp_path):
    (tmp_path / "included").mkdir()
    (tmp_path / "excluded").mkdir()
    (tmp_path / "included" / "a.py").write_text("needle", encoding="utf-8")
    (tmp_path / "excluded" / "b.py").write_text("needle", encoding="utf-8")

    result = await dispatch(
        "search_files", {"pattern": "needle", "path": "included"}, settings
    )

    assert not result.is_error
    assert "included" in result.content
    assert "excluded" not in result.content


async def test_search_files_bad_regex_is_an_error(settings, tmp_path):
    result = await dispatch("search_files", {"pattern": "("}, settings)

    assert result.is_error
    assert "Invalid regular expression" in result.content


async def test_search_files_sandbox_escape_refused(settings, tmp_path):
    result = await dispatch(
        "search_files", {"pattern": "x", "path": "../outside"}, settings
    )

    assert result.is_error
    assert "escapes the workspace sandbox" in result.content


async def test_glob_files_matches_pattern(settings, tmp_path):
    (tmp_path / "a.py").write_text("x", encoding="utf-8")
    (tmp_path / "a.txt").write_text("x", encoding="utf-8")

    result = await dispatch("glob_files", {"pattern": "*.py"}, settings)

    assert not result.is_error
    assert "a.py" in result.content
    assert "a.txt" not in result.content


async def test_glob_files_sandbox_escape_refused(settings, tmp_path):
    result = await dispatch(
        "glob_files", {"pattern": "*.py", "path": "../outside"}, settings
    )

    assert result.is_error
    assert "escapes the workspace sandbox" in result.content


async def test_file_exists_reports_missing(settings, tmp_path):
    result = await dispatch("file_exists", {"path": "missing.txt"}, settings)

    assert not result.is_error
    assert "does not exist" in result.content


async def test_file_exists_reports_file(settings, tmp_path):
    (tmp_path / "a.txt").write_text("hello", encoding="utf-8")

    result = await dispatch("file_exists", {"path": "a.txt"}, settings)

    assert not result.is_error
    assert "file" in result.content


async def test_file_exists_reports_directory(settings, tmp_path):
    (tmp_path / "sub").mkdir()

    result = await dispatch("file_exists", {"path": "sub"}, settings)

    assert not result.is_error
    assert "directory" in result.content


async def test_diff_files_identical(settings, tmp_path):
    (tmp_path / "a.txt").write_text("same\n", encoding="utf-8")
    (tmp_path / "b.txt").write_text("same\n", encoding="utf-8")

    result = await dispatch(
        "diff_files", {"path_a": "a.txt", "path_b": "b.txt"}, settings
    )

    assert not result.is_error
    assert result.content == "Files are identical."


async def test_diff_files_different(settings, tmp_path):
    (tmp_path / "a.txt").write_text("one\n", encoding="utf-8")
    (tmp_path / "b.txt").write_text("two\n", encoding="utf-8")

    result = await dispatch(
        "diff_files", {"path_a": "a.txt", "path_b": "b.txt"}, settings
    )

    assert not result.is_error
    assert "-one" in result.content
    assert "+two" in result.content
