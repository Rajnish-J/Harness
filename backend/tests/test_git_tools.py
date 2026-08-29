import subprocess

import pytest

from app.agent.llm.base import ToolCallRequest
from app.agent.loop import _dispatch_tool
from app.agent.tools.registry import ALL_TOOLS
from app.core.config import get_settings

TOOLS_BY_NAME = {tool.name: tool for tool in ALL_TOOLS}


def _git(*args, cwd):
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True)


@pytest.fixture
def settings(tmp_path):
    _git("init", cwd=tmp_path)
    _git("config", "user.email", "test@example.com", cwd=tmp_path)
    _git("config", "user.name", "Test", cwd=tmp_path)
    (tmp_path / "a.txt").write_text("hello", encoding="utf-8")
    return get_settings().model_copy(update={"workspace_root": tmp_path})


async def dispatch(name, arguments, settings):
    return await _dispatch_tool(
        ToolCallRequest(id="c1", name=name, arguments=arguments), settings, TOOLS_BY_NAME
    )


async def test_git_status_reports_untracked_file(settings):
    result = await dispatch("git_status", {}, settings)

    assert not result.is_error
    assert "a.txt" in result.content


async def test_git_add_stages_only_given_paths(settings, tmp_path):
    (tmp_path / "b.txt").write_text("other", encoding="utf-8")

    result = await dispatch("git_add", {"paths": ["a.txt"]}, settings)
    assert not result.is_error

    status = await dispatch("git_status", {}, settings)
    assert "A  a.txt" in status.content
    assert "b.txt" in status.content
    assert "A  b.txt" not in status.content


async def test_git_commit_with_nothing_staged_is_not_an_error(settings):
    result = await dispatch("git_commit", {"message": "empty"}, settings)

    assert not result.is_error
    assert "nothing" in result.content.lower()


async def test_git_add_then_commit_succeeds(settings, tmp_path):
    await dispatch("git_add", {"paths": ["a.txt"]}, settings)
    result = await dispatch("git_commit", {"message": "add a.txt"}, settings)

    assert not result.is_error

    log = await dispatch("git_log", {}, settings)
    assert "add a.txt" in log.content


async def test_git_diff_shows_unstaged_change(settings, tmp_path):
    await dispatch("git_add", {"paths": ["a.txt"]}, settings)
    await dispatch("git_commit", {"message": "add a.txt"}, settings)
    (tmp_path / "a.txt").write_text("changed", encoding="utf-8")

    result = await dispatch("git_diff", {}, settings)

    assert not result.is_error
    assert "-hello" in result.content
    assert "+changed" in result.content


async def test_git_branch_list_then_create(settings):
    # A branch needs a commit to point to.
    await dispatch("git_add", {"paths": ["a.txt"]}, settings)
    await dispatch("git_commit", {"message": "add a.txt"}, settings)

    listed = await dispatch("git_branch", {}, settings)
    assert not listed.is_error

    created = await dispatch("git_branch", {"create": "feature-x"}, settings)
    assert not created.is_error
    assert "(exit code 0)" in created.content

    relisted = await dispatch("git_branch", {}, settings)
    assert "feature-x" in relisted.content


async def test_git_show_known_commit(settings):
    await dispatch("git_add", {"paths": ["a.txt"]}, settings)
    await dispatch("git_commit", {"message": "add a.txt"}, settings)

    result = await dispatch("git_show", {"ref": "HEAD"}, settings)

    assert not result.is_error
    assert "add a.txt" in result.content


async def test_git_add_sandbox_escape_refused(settings):
    result = await dispatch("git_add", {"paths": ["../outside.txt"]}, settings)

    assert result.is_error
    assert "escapes the workspace sandbox" in result.content


async def test_git_status_path_sandbox_escape_refused(settings):
    result = await dispatch("git_status", {"path": "../outside"}, settings)

    assert result.is_error
    assert "escapes the workspace sandbox" in result.content
