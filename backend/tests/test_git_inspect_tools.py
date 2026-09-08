"""git_blame and git_stash, against a real repository.

Same approach as test_git_tools.py: a throwaway repo in tmp_path. These tools
are thin wrappers over git's own argv, so stubbing the subprocess would only
assert that the arguments are the ones written two lines above -- running real
git is what actually tells us the commands are well formed.
"""

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
    (tmp_path / "a.txt").write_text("one\ntwo\nthree\n", encoding="utf-8")
    _git("add", "a.txt", cwd=tmp_path)
    _git("commit", "-m", "initial", cwd=tmp_path)
    return get_settings().model_copy(update={"workspace_root": tmp_path})


async def dispatch(name, arguments, settings):
    return await _dispatch_tool(
        ToolCallRequest(id="c1", name=name, arguments=arguments), settings, TOOLS_BY_NAME
    )


# -------------------------------------------------------------------- git_blame


async def test_blame_attributes_committed_lines(settings):
    result = await dispatch("git_blame", {"file": "a.txt"}, settings)

    assert not result.is_error
    assert "Test" in result.content
    assert "one" in result.content


async def test_blame_honours_a_line_range(settings):
    result = await dispatch(
        "git_blame", {"file": "a.txt", "start_line": 2, "end_line": 2}, settings
    )

    assert not result.is_error
    assert "two" in result.content
    assert "three" not in result.content


async def test_blame_rejects_a_backwards_range(settings):
    result = await dispatch(
        "git_blame", {"file": "a.txt", "start_line": 3, "end_line": 1}, settings
    )

    assert result.is_error
    assert "after end_line" in result.content


async def test_blame_rejects_a_half_given_range(settings):
    result = await dispatch("git_blame", {"file": "a.txt", "start_line": 2}, settings)

    assert result.is_error
    assert "both" in result.content


async def test_blame_rejects_line_zero(settings):
    result = await dispatch(
        "git_blame", {"file": "a.txt", "start_line": 0, "end_line": 2}, settings
    )

    assert result.is_error


async def test_blame_refuses_a_file_outside_the_workspace(settings):
    result = await dispatch("git_blame", {"file": "../outside.txt"}, settings)

    assert result.is_error
    assert "outside the workspace" in result.content


async def test_blame_of_an_untracked_file_is_output_not_an_error(settings, tmp_path):
    """Git's own non-zero exit is a result to read, matching the other git tools."""
    (tmp_path / "new.txt").write_text("fresh\n", encoding="utf-8")

    result = await dispatch("git_blame", {"file": "new.txt"}, settings)

    assert not result.is_error
    assert "exit code" in result.content


# -------------------------------------------------------------------- git_stash


async def test_stash_list_on_a_clean_repo(settings):
    result = await dispatch("git_stash", {}, settings)

    assert not result.is_error
    assert "exit code 0" in result.content


async def test_push_then_pop_round_trips_a_change(settings, tmp_path):
    (tmp_path / "a.txt").write_text("modified\n", encoding="utf-8")

    pushed = await dispatch("git_stash", {"action": "push", "message": "wip"}, settings)
    assert not pushed.is_error
    assert (tmp_path / "a.txt").read_text(encoding="utf-8") == "one\ntwo\nthree\n"

    listed = await dispatch("git_stash", {"action": "list"}, settings)
    assert "wip" in listed.content

    popped = await dispatch("git_stash", {"action": "pop"}, settings)
    assert not popped.is_error
    assert (tmp_path / "a.txt").read_text(encoding="utf-8") == "modified\n"


async def test_stash_show_displays_a_diff(settings, tmp_path):
    (tmp_path / "a.txt").write_text("changed\n", encoding="utf-8")
    await dispatch("git_stash", {"action": "push"}, settings)

    result = await dispatch("git_stash", {"action": "show"}, settings)

    assert not result.is_error
    assert "changed" in result.content


async def test_drop_is_refused(settings):
    """Pins the policy: git tools here never destroy work."""
    result = await dispatch("git_stash", {"action": "drop"}, settings)

    assert result.is_error
    assert "deliberately not available" in result.content


async def test_clear_is_refused(settings):
    result = await dispatch("git_stash", {"action": "clear"}, settings)

    assert result.is_error


async def test_the_schema_does_not_advertise_destructive_actions(settings):
    actions = TOOLS_BY_NAME["git_stash"].input_schema["properties"]["action"]["enum"]

    assert "drop" not in actions
    assert "clear" not in actions
