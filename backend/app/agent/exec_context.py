"""Where a shell command actually runs.

Until now every command ran as a subprocess on the host, which is fine for a
single fixed sandbox but wrong once a project is a real repository: a Node repo
needs Node, a Python repo needs its own interpreter, and neither should have to
exist on the operator's machine.

This is the seam that makes that switchable. Both implementations answer the
same question — "run this command, give me the exit code and the output" — so
the shell tools call one interface and never learn which they were given.

The split that matters, and the reason DockerExec is not simply "how commands
run now":

    file read/write/list/search   -> the HOST filesystem
    run_command, tests, lint      -> the CONTAINER

Files stay on the host because the container bind-mounts the same directory:
reading a file through `docker exec cat` would be slower, would lose
`resolve_safe_path`'s guarantees, and would buy nothing. A useful consequence is
that the project IDE keeps working with the container stopped — you can browse
and edit code, and only "run something" needs a daemon.
"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Protocol, runtime_checkable

from app.agent.tools._process import run_subprocess

logger = logging.getLogger(__name__)

#: Where a project's checkout is mounted inside its container.
CONTAINER_WORKDIR = "/workspace"


def _truncate(output: str, max_output_bytes: int) -> str:
    """Match run_subprocess's truncation, so both backends cap identically."""
    encoded = output.encode("utf-8", errors="replace")
    if len(encoded) <= max_output_bytes:
        return output
    return (
        encoded[:max_output_bytes].decode("utf-8", errors="ignore") + "\n... (truncated)"
    )


@runtime_checkable
class ExecutionContext(Protocol):
    """Run a command somewhere and report (exit_code, combined output)."""

    async def run(
        self,
        command: str | list[str],
        *,
        cwd: Path,
        timeout: float,
        max_output_bytes: int,
        shell: bool,
    ) -> tuple[int, str]: ...

    @property
    def description(self) -> str:
        """One line for the operator: where did this command run?"""
        ...


class LocalExec:
    """A subprocess on the host. The default, and unchanged behaviour."""

    @property
    def description(self) -> str:
        return "host"

    async def run(
        self,
        command: str | list[str],
        *,
        cwd: Path,
        timeout: float,
        max_output_bytes: int,
        shell: bool,
    ) -> tuple[int, str]:
        return await run_subprocess(
            command,
            cwd=cwd,
            timeout=timeout,
            max_output_bytes=max_output_bytes,
            shell=shell,
        )


class DockerExec:
    """`docker exec` into one project's container.

    `cwd` is a HOST path, because that is what the file tools and the sandbox
    guard both speak. It is translated to a container path relative to the bind
    mount, so a command run in `<workspace>/src` lands in `/workspace/src`. A
    cwd outside the mount is a programming error, not a user error, and raises.
    """

    def __init__(self, client, container_id: str, host_mount: Path) -> None:
        self._client = client
        self._container_id = container_id
        self._host_mount = host_mount.resolve()

    @property
    def description(self) -> str:
        return f"container {self._container_id[:12]}"

    def _container_path(self, cwd: Path) -> str:
        resolved = cwd.resolve()
        if resolved == self._host_mount:
            return CONTAINER_WORKDIR
        if not resolved.is_relative_to(self._host_mount):
            raise ValueError(
                f"{cwd} is outside the container's mount ({self._host_mount})"
            )
        # PurePosix on purpose: the container is Linux even when the host is not.
        relative = resolved.relative_to(self._host_mount).as_posix()
        return f"{CONTAINER_WORKDIR}/{relative}"

    def _exec_blocking(self, argv: list[str], workdir: str) -> tuple[int, str]:
        container = self._client.containers.get(self._container_id)
        result = container.exec_run(
            argv,
            workdir=workdir,
            demux=False,  # one combined stream, like run_subprocess returns
            tty=False,
        )
        output = result.output or b""
        if isinstance(output, bytes):
            output = output.decode("utf-8", errors="replace")
        # exit_code is None while the exec is still running, which should not
        # happen with detach=False, but a None would silently read as success.
        code = result.exit_code if result.exit_code is not None else -1
        return code, output

    async def run(
        self,
        command: str | list[str],
        *,
        cwd: Path,
        timeout: float,
        max_output_bytes: int,
        shell: bool,
    ) -> tuple[int, str]:
        workdir = self._container_path(cwd)

        if shell:
            # A shell string needs a shell to interpret it. `sh -c`, not
            # `bash -lc`: sh exists in every base image worth using.
            text = command if isinstance(command, str) else " ".join(command)
            argv = ["/bin/sh", "-c", text]
        else:
            argv = [command] if isinstance(command, str) else list(command)

        try:
            # The SDK is synchronous. Without to_thread this would block the
            # event loop for the whole command, stalling every concurrent SSE
            # stream in the process.
            code, output = await asyncio.wait_for(
                asyncio.to_thread(self._exec_blocking, argv, workdir),
                timeout=timeout,
            )
        except asyncio.TimeoutError:
            # Unlike subprocess.run, exec_run has no timeout of its own, so the
            # command keeps running in the container after we stop waiting. Say
            # so rather than implying it was killed.
            return 124, (
                f"Command exceeded {timeout}s and was abandoned. It may still be "
                f"running inside {self.description}."
            )
        except Exception as exc:  # noqa: BLE001 - surfaced as a tool result
            logger.warning("docker exec failed in %s: %s", self._container_id, exc)
            return 125, f"Could not run the command in the container: {exc}"

        return code, _truncate(output, max_output_bytes)
