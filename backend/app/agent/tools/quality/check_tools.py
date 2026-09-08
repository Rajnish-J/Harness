"""`run_typecheck` and `run_format`: the other two configured project commands.

Both delegate to shell_tools._run_configured rather than reimplementing it, so
they inherit the whole contract already tested there: the container executor
when a project has one, the timeout, the output cap, the `$ cmd / (exit code)`
shape, and -- most importantly -- the refusal message when nothing is
configured. Passing label="typecheck" produces a message naming
TYPECHECK_COMMAND, which is exactly the setting a reader needs to go set.

They live here rather than in shell_tools because ALL_TOOLS is append-only:
adding them to SHELL_TOOLS would shift every tool defined after it and
invalidate the cached prompt prefix for sessions already in flight. The group
is still Execution, so the UI files them beside run_tests where they belong.
"""

from __future__ import annotations

from pathlib import Path

from app.agent.exec_context import ExecutionContext
from app.agent.tools.base import Tool
from app.agent.tools.execution.shell_tools import SHELL_GROUP, _CWD_PROPERTY, _run_configured


async def run_typecheck(
    command: str | None = None,
    cwd: str = ".",
    *,
    workspace_root: Path,
    command_timeout_seconds: float,
    max_command_output_bytes: int,
    typecheck_command: str | None = None,
    executor: ExecutionContext | None = None,
    **_ignored: object,
) -> str:
    return await _run_configured(
        "typecheck",
        command,
        typecheck_command,
        cwd=cwd,
        workspace_root=workspace_root,
        executor=executor,
        command_timeout_seconds=command_timeout_seconds,
        max_command_output_bytes=max_command_output_bytes,
    )


async def run_format(
    command: str | None = None,
    cwd: str = ".",
    *,
    workspace_root: Path,
    command_timeout_seconds: float,
    max_command_output_bytes: int,
    format_command: str | None = None,
    executor: ExecutionContext | None = None,
    **_ignored: object,
) -> str:
    return await _run_configured(
        "format",
        command,
        format_command,
        cwd=cwd,
        workspace_root=workspace_root,
        executor=executor,
        command_timeout_seconds=command_timeout_seconds,
        max_command_output_bytes=max_command_output_bytes,
    )


CHECK_TOOLS: list[Tool] = [
    Tool(
        name="run_typecheck",
        description=(
            "Run the project's configured type checker (mypy, pyright, tsc, "
            "whatever is set). Usually the fastest way to find out whether an "
            "edit actually holds together. Fails with a clear message if no "
            "typecheck command is configured and none is passed -- that is a "
            "real answer about the project, not a transient error, so do not "
            "retry it."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "command": {
                    "type": "string",
                    "description": "Override the configured typecheck command.",
                },
                "cwd": _CWD_PROPERTY,
            },
            "required": [],
            "additionalProperties": False,
        },
        run=run_typecheck,
        group=SHELL_GROUP,
    ),
    Tool(
        name="run_format",
        description=(
            "Run the project's configured formatter. This REWRITES FILES IN "
            "PLACE, including files you did not touch, so run git_diff "
            "afterwards to see what actually changed. Fails with a clear "
            "message if no format command is configured and none is passed."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "command": {
                    "type": "string",
                    "description": "Override the configured format command.",
                },
                "cwd": _CWD_PROPERTY,
            },
            "required": [],
            "additionalProperties": False,
        },
        run=run_format,
        group=SHELL_GROUP,
    ),
]
