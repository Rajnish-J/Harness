from pathlib import Path

from app.agent.exec_context import ExecutionContext, LocalExec
from app.agent.tools.base import Tool, ToolExecutionError
from app.core.workspace import resolve_safe_path


def _resolve_cwd(cwd: str, workspace_root: Path) -> Path:
    target = resolve_safe_path(cwd or ".", workspace_root)
    if not target.exists():
        raise ToolExecutionError(f"No such directory: {cwd}")
    if not target.is_dir():
        raise ToolExecutionError(f"{cwd} is a file, not a directory.")
    return target


def _format_result(command: str, returncode: int, output: str) -> str:
    body = output if output else "(no output)"
    return f"$ {command}\n(exit code {returncode})\n{body}"


async def run_command(
    command: str,
    cwd: str = ".",
    *,
    workspace_root: Path,
    command_timeout_seconds: float,
    max_command_output_bytes: int,
    executor: ExecutionContext | None = None,
    **_ignored: object,
) -> str:
    resolved_cwd = _resolve_cwd(cwd, workspace_root)
    # Defaults to the host, so a chat with no project attached behaves exactly
    # as it did before containers existed.
    returncode, output = await (executor or LocalExec()).run(
        command,
        cwd=resolved_cwd,
        timeout=command_timeout_seconds,
        max_output_bytes=max_command_output_bytes,
        shell=True,
    )
    return _format_result(command, returncode, output)


async def _run_configured(
    label: str,
    override: str | None,
    configured: str | None,
    *,
    cwd: str,
    workspace_root: Path,
    command_timeout_seconds: float,
    max_command_output_bytes: int,
    executor: ExecutionContext | None = None,
) -> str:
    command = override or configured
    if not command:
        env_name = f"{label.upper()}_COMMAND"
        raise ToolExecutionError(
            f"No {label} command configured (set {env_name} in .env, or pass "
            "an explicit command)."
        )

    resolved_cwd = _resolve_cwd(cwd, workspace_root)
    returncode, output = await (executor or LocalExec()).run(
        command,
        cwd=resolved_cwd,
        timeout=command_timeout_seconds,
        max_output_bytes=max_command_output_bytes,
        shell=True,
    )
    return _format_result(command, returncode, output)


async def run_tests(
    command: str | None = None,
    cwd: str = ".",
    *,
    workspace_root: Path,
    command_timeout_seconds: float,
    max_command_output_bytes: int,
    test_command: str | None,
    executor: ExecutionContext | None = None,
    **_ignored: object,
) -> str:
    return await _run_configured(
        "test",
        command,
        test_command,
        cwd=cwd,
        workspace_root=workspace_root,
        executor=executor,
        command_timeout_seconds=command_timeout_seconds,
        max_command_output_bytes=max_command_output_bytes,
    )


async def run_lint(
    command: str | None = None,
    cwd: str = ".",
    *,
    workspace_root: Path,
    command_timeout_seconds: float,
    max_command_output_bytes: int,
    lint_command: str | None,
    executor: ExecutionContext | None = None,
    **_ignored: object,
) -> str:
    return await _run_configured(
        "lint",
        command,
        lint_command,
        cwd=cwd,
        workspace_root=workspace_root,
        executor=executor,
        command_timeout_seconds=command_timeout_seconds,
        max_command_output_bytes=max_command_output_bytes,
    )


async def run_build(
    command: str | None = None,
    cwd: str = ".",
    *,
    workspace_root: Path,
    command_timeout_seconds: float,
    max_command_output_bytes: int,
    build_command: str | None,
    executor: ExecutionContext | None = None,
    **_ignored: object,
) -> str:
    return await _run_configured(
        "build",
        command,
        build_command,
        cwd=cwd,
        workspace_root=workspace_root,
        executor=executor,
        command_timeout_seconds=command_timeout_seconds,
        max_command_output_bytes=max_command_output_bytes,
    )


#: Commands that actually run something, as distinct from Validation's
#: read-only search/inspection tools.
SHELL_GROUP = "Execution"

_CWD_PROPERTY = {
    "type": "string",
    "description": "Working directory relative to the workspace root. Defaults to the workspace root.",
}

SHELL_TOOLS: list[Tool] = [
    Tool(
        name="run_command",
        description=(
            "Run a shell command in the sandboxed workspace. The working "
            "directory is pinned inside the workspace and the command is "
            "killed if it runs longer than the configured timeout. A non-zero "
            "exit code is returned as normal output, not an error."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "command": {"type": "string", "description": "The shell command to run."},
                "cwd": _CWD_PROPERTY,
            },
            "required": ["command"],
            "additionalProperties": False,
        },
        run=run_command,
        group=SHELL_GROUP,
    ),
    Tool(
        name="run_tests",
        description=(
            "Run the project's configured test command. Fails with a clear "
            "message if none is configured and no explicit command is given."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "command": {
                    "type": "string",
                    "description": "Override the configured test command.",
                },
                "cwd": _CWD_PROPERTY,
            },
            "required": [],
            "additionalProperties": False,
        },
        run=run_tests,
        group=SHELL_GROUP,
    ),
    Tool(
        name="run_lint",
        description=(
            "Run the project's configured lint command. Fails with a clear "
            "message if none is configured and no explicit command is given."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "command": {
                    "type": "string",
                    "description": "Override the configured lint command.",
                },
                "cwd": _CWD_PROPERTY,
            },
            "required": [],
            "additionalProperties": False,
        },
        run=run_lint,
        group=SHELL_GROUP,
    ),
    Tool(
        name="run_build",
        description=(
            "Run the project's configured build command. Fails with a clear "
            "message if none is configured and no explicit command is given."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "command": {
                    "type": "string",
                    "description": "Override the configured build command.",
                },
                "cwd": _CWD_PROPERTY,
            },
            "required": [],
            "additionalProperties": False,
        },
        run=run_build,
        group=SHELL_GROUP,
    ),
]
