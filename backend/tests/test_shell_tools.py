import sys

import pytest

from app.agent.llm.base import ToolCallRequest
from app.agent.loop import _dispatch_tool
from app.agent.tools.registry import ALL_TOOLS
from app.core.config import get_settings

TOOLS_BY_NAME = {tool.name: tool for tool in ALL_TOOLS}

PY = sys.executable


@pytest.fixture
def settings(tmp_path):
    return get_settings().model_copy(update={"workspace_root": tmp_path})


async def dispatch(name, arguments, settings):
    return await _dispatch_tool(
        ToolCallRequest(id="c1", name=name, arguments=arguments), settings, TOOLS_BY_NAME
    )


async def test_run_command_success_reports_exit_code(settings):
    result = await dispatch("run_command", {"command": f'"{PY}" -c "print(1)"'}, settings)

    assert not result.is_error
    assert "(exit code 0)" in result.content
    assert "1" in result.content


async def test_run_command_nonzero_exit_is_not_an_error(settings):
    result = await dispatch(
        "run_command", {"command": f'"{PY}" -c "import sys; sys.exit(3)"'}, settings
    )

    assert not result.is_error
    assert "(exit code 3)" in result.content


async def test_run_command_timeout_is_an_error(settings):
    fast_settings = settings.model_copy(update={"command_timeout_seconds": 0.2})

    result = await dispatch(
        "run_command",
        {"command": f'"{PY}" -c "import time; time.sleep(5)"'},
        fast_settings,
    )

    assert result.is_error
    assert "timed out" in result.content


async def test_run_command_cwd_sandbox_escape_refused(settings):
    result = await dispatch(
        "run_command", {"command": "echo hi", "cwd": "../outside"}, settings
    )

    assert result.is_error
    assert "escapes the workspace sandbox" in result.content


async def test_run_command_output_is_truncated(settings):
    tight_settings = settings.model_copy(update={"max_command_output_bytes": 10})

    result = await dispatch(
        "run_command",
        {"command": f'"{PY}" -c "print(\'x\' * 1000)"'},
        tight_settings,
    )

    assert not result.is_error
    assert "(truncated)" in result.content


async def test_run_tests_unconfigured_is_a_clear_error(settings):
    result = await dispatch("run_tests", {}, settings)

    assert result.is_error
    assert "No test command configured" in result.content


async def test_run_tests_configured_runs(settings):
    configured = settings.model_copy(
        update={"test_command": f'"{PY}" -c "print(\'ran tests\')"'}
    )

    result = await dispatch("run_tests", {}, configured)

    assert not result.is_error
    assert "ran tests" in result.content


async def test_run_tests_explicit_override_wins(settings):
    configured = settings.model_copy(update={"test_command": "should not run"})

    result = await dispatch(
        "run_tests", {"command": f'"{PY}" -c "print(\'override\')"'}, configured
    )

    assert not result.is_error
    assert "override" in result.content
