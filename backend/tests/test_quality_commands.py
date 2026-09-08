"""run_typecheck and run_format.

Nothing here spawns a real process. A stub ExecutionContext records what it was
asked to run, which is the only interesting part -- the subprocess machinery
itself is already covered by test_shell_tools.py, and spawning a real one here
would make the suite slower and platform-dependent for no extra assurance.
"""

from pathlib import Path

import pytest

from app.agent.llm.base import ToolCallRequest
from app.agent.loop import _dispatch_tool
from app.agent.tools.registry import ALL_TOOLS
from app.core.config import get_settings

TOOLS_BY_NAME = {tool.name: tool for tool in ALL_TOOLS}


class RecordingExec:
    """An ExecutionContext that runs nothing and remembers everything."""

    def __init__(self, exit_code: int = 0, output: str = "clean"):
        self.calls: list[dict] = []
        self._exit_code = exit_code
        self._output = output

    async def run(self, command, *, cwd, timeout, max_output_bytes, shell):
        self.calls.append(
            {
                "command": command,
                "cwd": Path(cwd),
                "timeout": timeout,
                "shell": shell,
            }
        )
        return self._exit_code, self._output


@pytest.fixture
def settings(tmp_path):
    return get_settings().model_copy(update={"workspace_root": tmp_path})


async def dispatch(name, arguments, settings, executor=None):
    return await _dispatch_tool(
        ToolCallRequest(id="c1", name=name, arguments=arguments),
        settings,
        TOOLS_BY_NAME,
        executor,
    )


# ------------------------------------------------------------- refusal contract


async def test_typecheck_refuses_when_unconfigured(settings):
    result = await dispatch("run_typecheck", {}, settings)

    assert result.is_error
    assert "TYPECHECK_COMMAND" in result.content


async def test_format_refuses_when_unconfigured(settings):
    result = await dispatch("run_format", {}, settings)

    assert result.is_error
    assert "FORMAT_COMMAND" in result.content


async def test_refusal_names_the_setting_not_a_guess(settings):
    """The message has to name what to go set, not suggest a tool to install."""
    result = await dispatch("run_typecheck", {}, settings)

    assert "No typecheck command configured" in result.content


# ------------------------------------------------------------------- execution


async def test_typecheck_runs_the_configured_command(tmp_path):
    settings = get_settings().model_copy(
        update={"workspace_root": tmp_path, "typecheck_command": "mypy app"}
    )
    executor = RecordingExec(exit_code=0, output="Success: no issues found")

    result = await dispatch("run_typecheck", {}, settings, executor)

    assert not result.is_error
    assert executor.calls[0]["command"] == "mypy app"
    assert "exit code 0" in result.content
    assert "Success: no issues found" in result.content


async def test_format_runs_the_configured_command(tmp_path):
    settings = get_settings().model_copy(
        update={"workspace_root": tmp_path, "format_command": "ruff format ."}
    )
    executor = RecordingExec()

    result = await dispatch("run_format", {}, settings, executor)

    assert not result.is_error
    assert executor.calls[0]["command"] == "ruff format ."


async def test_an_explicit_command_overrides_the_configured_one(tmp_path):
    settings = get_settings().model_copy(
        update={"workspace_root": tmp_path, "typecheck_command": "mypy app"}
    )
    executor = RecordingExec()

    await dispatch("run_typecheck", {"command": "pyright"}, settings, executor)

    assert executor.calls[0]["command"] == "pyright"


async def test_an_explicit_command_works_with_nothing_configured(settings):
    """An override is a complete answer on its own -- no config required."""
    executor = RecordingExec()

    result = await dispatch("run_typecheck", {"command": "tsc --noEmit"}, settings, executor)

    assert not result.is_error
    assert executor.calls[0]["command"] == "tsc --noEmit"


async def test_the_executor_is_used_so_container_runs_reach_the_container(tmp_path):
    """Same seam as run_tests: a project with a container must not run on the host."""
    settings = get_settings().model_copy(
        update={"workspace_root": tmp_path, "typecheck_command": "mypy"}
    )
    executor = RecordingExec()

    await dispatch("run_typecheck", {}, settings, executor)

    assert len(executor.calls) == 1


async def test_a_failing_check_is_output_not_an_error(tmp_path):
    """Non-zero exit is a result the model should read, not a tool failure."""
    settings = get_settings().model_copy(
        update={"workspace_root": tmp_path, "typecheck_command": "mypy"}
    )
    executor = RecordingExec(exit_code=1, output="error: incompatible type")

    result = await dispatch("run_typecheck", {}, settings, executor)

    assert not result.is_error
    assert "exit code 1" in result.content
    assert "incompatible type" in result.content


async def test_cwd_is_pinned_inside_the_workspace(tmp_path):
    settings = get_settings().model_copy(
        update={"workspace_root": tmp_path, "typecheck_command": "mypy"}
    )
    (tmp_path / "sub").mkdir()
    executor = RecordingExec()

    await dispatch("run_typecheck", {"cwd": "sub"}, settings, executor)

    assert executor.calls[0]["cwd"] == tmp_path / "sub"


async def test_cwd_outside_the_workspace_is_refused(tmp_path):
    settings = get_settings().model_copy(
        update={"workspace_root": tmp_path, "typecheck_command": "mypy"}
    )
    executor = RecordingExec()

    result = await dispatch("run_typecheck", {"cwd": "../elsewhere"}, settings, executor)

    assert result.is_error
    assert executor.calls == []
