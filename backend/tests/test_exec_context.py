"""The execution seam.

DockerExec is tested against a fake client rather than a real daemon: what needs
pinning is the translation between host paths and container paths, and the
failure behaviour, neither of which a live container would exercise more
honestly. Actually running a container is verified by hand -- see the milestone
notes.
"""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from app.agent.exec_context import (
    CONTAINER_WORKDIR,
    DockerExec,
    ExecutionContext,
    LocalExec,
    _truncate,
)


class FakeExecResult:
    def __init__(self, exit_code, output):
        self.exit_code = exit_code
        self.output = output


class FakeContainer:
    """Records what it was asked to run, so the call can be asserted on."""

    def __init__(self, exit_code=0, output=b"ok", delay=0.0):
        self.calls: list[dict] = []
        self._exit_code = exit_code
        self._output = output
        self._delay = delay

    def exec_run(self, argv, workdir=None, demux=None, tty=None):
        self.calls.append({"argv": argv, "workdir": workdir, "demux": demux, "tty": tty})
        if self._delay:
            import time

            time.sleep(self._delay)
        return FakeExecResult(self._exit_code, self._output)


class FakeClient:
    def __init__(self, container):
        self.containers = self
        self._container = container

    def get(self, _id):
        return self._container


@pytest.fixture
def mount(tmp_path: Path) -> Path:
    (tmp_path / "src" / "lib").mkdir(parents=True)
    return tmp_path


# --------------------------------------------------------------------- Local


def test_local_exec_satisfies_the_protocol() -> None:
    assert isinstance(LocalExec(), ExecutionContext)


def test_docker_exec_satisfies_the_protocol(mount: Path) -> None:
    assert isinstance(DockerExec(FakeClient(FakeContainer()), "abc", mount), ExecutionContext)


def test_descriptions_say_where_a_command_ran(mount: Path) -> None:
    assert LocalExec().description == "host"
    exec_ = DockerExec(FakeClient(FakeContainer()), "abcdef0123456789", mount)
    assert "abcdef012345" in exec_.description


@pytest.mark.asyncio
async def test_local_exec_actually_runs_a_command(tmp_path: Path) -> None:
    code, output = await LocalExec().run(
        "echo hello-from-host",
        cwd=tmp_path,
        timeout=30,
        max_output_bytes=10_000,
        shell=True,
    )
    assert code == 0
    assert "hello-from-host" in output


# -------------------------------------------------------------- Path mapping


@pytest.mark.asyncio
async def test_mount_root_maps_to_the_container_workdir(mount: Path) -> None:
    container = FakeContainer()
    await DockerExec(FakeClient(container), "abc", mount).run(
        "ls", cwd=mount, timeout=5, max_output_bytes=1000, shell=True
    )
    assert container.calls[0]["workdir"] == CONTAINER_WORKDIR


@pytest.mark.asyncio
async def test_subdirectory_maps_below_the_workdir(mount: Path) -> None:
    container = FakeContainer()
    await DockerExec(FakeClient(container), "abc", mount).run(
        "ls", cwd=mount / "src" / "lib", timeout=5, max_output_bytes=1000, shell=True
    )
    # Forward slashes even though the host path is a WindowsPath: the container
    # is Linux regardless of what the host runs.
    assert container.calls[0]["workdir"] == f"{CONTAINER_WORKDIR}/src/lib"


@pytest.mark.asyncio
async def test_cwd_outside_the_mount_is_refused(mount: Path, tmp_path: Path) -> None:
    """A path outside the bind mount does not exist in the container at all."""
    outside = tmp_path.parent / "somewhere-else"
    outside.mkdir(exist_ok=True)
    with pytest.raises(ValueError, match="outside the container"):
        await DockerExec(FakeClient(FakeContainer()), "abc", mount).run(
            "ls", cwd=outside, timeout=5, max_output_bytes=1000, shell=True
        )


# ------------------------------------------------------------------ Invocation


@pytest.mark.asyncio
async def test_shell_commands_go_through_sh(mount: Path) -> None:
    """A shell string needs a shell; sh exists in every base image worth using."""
    container = FakeContainer()
    await DockerExec(FakeClient(container), "abc", mount).run(
        "ls | wc -l", cwd=mount, timeout=5, max_output_bytes=1000, shell=True
    )
    assert container.calls[0]["argv"] == ["/bin/sh", "-c", "ls | wc -l"]


@pytest.mark.asyncio
async def test_argv_commands_bypass_the_shell(mount: Path) -> None:
    container = FakeContainer()
    await DockerExec(FakeClient(container), "abc", mount).run(
        ["git", "status"], cwd=mount, timeout=5, max_output_bytes=1000, shell=False
    )
    assert container.calls[0]["argv"] == ["git", "status"]


@pytest.mark.asyncio
async def test_output_is_decoded_and_exit_code_preserved(mount: Path) -> None:
    container = FakeContainer(exit_code=3, output=b"boom\n")
    code, output = await DockerExec(FakeClient(container), "abc", mount).run(
        "false", cwd=mount, timeout=5, max_output_bytes=1000, shell=True
    )
    assert code == 3
    assert output == "boom\n"


@pytest.mark.asyncio
async def test_undecodable_output_does_not_raise(mount: Path) -> None:
    container = FakeContainer(output=b"\xff\xfe not utf-8")
    code, output = await DockerExec(FakeClient(container), "abc", mount).run(
        "cat", cwd=mount, timeout=5, max_output_bytes=1000, shell=True
    )
    assert code == 0
    assert "not utf-8" in output


@pytest.mark.asyncio
async def test_a_null_exit_code_is_not_reported_as_success(mount: Path) -> None:
    """exit_code is None while an exec is still running; 0 would be a lie."""
    container = FakeContainer(exit_code=None)
    code, _ = await DockerExec(FakeClient(container), "abc", mount).run(
        "sleep 1", cwd=mount, timeout=5, max_output_bytes=1000, shell=True
    )
    assert code != 0


@pytest.mark.asyncio
async def test_output_is_truncated_to_the_cap(mount: Path) -> None:
    container = FakeContainer(output=b"x" * 5000)
    _, output = await DockerExec(FakeClient(container), "abc", mount).run(
        "cat big", cwd=mount, timeout=5, max_output_bytes=100, shell=True
    )
    assert "truncated" in output
    assert len(output) < 5000


# -------------------------------------------------------------------- Failure


class ExplodingClient:
    def __init__(self):
        self.containers = self

    def get(self, _id):
        raise RuntimeError("container is gone")


@pytest.mark.asyncio
async def test_a_missing_container_is_a_result_not_an_exception(mount: Path) -> None:
    """Tool failures are results the model reads and recovers from."""
    code, output = await DockerExec(ExplodingClient(), "abc", mount).run(
        "ls", cwd=mount, timeout=5, max_output_bytes=1000, shell=True
    )
    assert code != 0
    assert "container is gone" in output


@pytest.mark.asyncio
async def test_timeout_says_the_command_may_still_be_running(mount: Path) -> None:
    """exec_run has no timeout of its own, so we abandon rather than kill."""
    container = FakeContainer(delay=0.5)
    code, output = await DockerExec(FakeClient(container), "abc", mount).run(
        "sleep 60", cwd=mount, timeout=0.05, max_output_bytes=1000, shell=True
    )
    assert code == 124
    assert "may still be running" in output


# ------------------------------------------------------------------ Truncation


def test_truncate_leaves_short_output_alone() -> None:
    assert _truncate("short", 1000) == "short"


def test_truncate_never_splits_a_multibyte_character() -> None:
    """Cutting mid-character would produce output that cannot be decoded."""
    text = "é" * 100  # two bytes each
    assert _truncate(text, 51).encode("utf-8", errors="strict")


@pytest.mark.asyncio
async def test_concurrent_execs_do_not_serialise(mount: Path) -> None:
    """to_thread is what keeps one slow command off the event loop."""
    container = FakeContainer(delay=0.2)
    exec_ = DockerExec(FakeClient(container), "abc", mount)

    async def once():
        return await exec_.run(
            "sleep", cwd=mount, timeout=10, max_output_bytes=1000, shell=True
        )

    started = asyncio.get_running_loop().time()
    await asyncio.gather(once(), once(), once())
    elapsed = asyncio.get_running_loop().time() - started
    # Serialised would be ~0.6s; in threads it should be nearer one delay.
    assert elapsed < 0.5
