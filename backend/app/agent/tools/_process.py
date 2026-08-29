"""Subprocess execution shared by the shell and git tools.

Runs via `subprocess.run` inside `asyncio.to_thread`, not
`asyncio.create_subprocess_*`. On Windows, `uvicorn --reload` (required for
this backend — psycopg's async pool cannot use ProactorEventLoop) leaves a
SelectorEventLoop running, and asyncio has no subprocess transport for that
loop on win32 (`NotImplementedError`). Running the blocking call in a worker
thread sidesteps the event loop's subprocess support entirely, so it works
under any loop policy on any platform.
"""

from __future__ import annotations

import asyncio
import subprocess
from pathlib import Path

from app.agent.tools.base import ToolExecutionError


def _run_blocking(
    command: str | list[str], *, cwd: Path, timeout: float, shell: bool
) -> tuple[int, str]:
    try:
        completed = subprocess.run(
            command,
            cwd=cwd,
            shell=shell,
            capture_output=True,
            timeout=timeout,
            encoding="utf-8",
            errors="replace",
        )
    except FileNotFoundError as exc:
        # argv form only (shell=False) — the executable itself wasn't found.
        return 127, str(exc)

    return completed.returncode, (completed.stdout or "") + (completed.stderr or "")


async def run_subprocess(
    command: str | list[str],
    *,
    cwd: Path,
    timeout: float,
    max_output_bytes: int,
    shell: bool,
) -> tuple[int, str]:
    """Run `command` in `cwd`, returning (exit_code, combined stdout+stderr).

    `shell=True` takes a command string and goes through the platform shell.
    `shell=False` takes an argv list and never touches a shell, which is why
    every git tool uses that form — arguments cannot be shell-injected.

    Raises `ToolExecutionError` on timeout; `subprocess.run`'s own timeout
    handling kills the child process before re-raising, so nothing is left
    running.
    """
    try:
        returncode, output = await asyncio.to_thread(
            _run_blocking, command, cwd=cwd, timeout=timeout, shell=shell
        )
    except subprocess.TimeoutExpired as exc:
        raise ToolExecutionError(
            f"Command timed out after {timeout}s and was killed."
        ) from exc

    encoded = output.encode("utf-8", errors="replace")
    if len(encoded) > max_output_bytes:
        output = (
            encoded[:max_output_bytes].decode("utf-8", errors="ignore")
            + "\n... (truncated)"
        )
    return returncode, output
