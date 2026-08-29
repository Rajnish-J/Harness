"""Which executor a project's commands get, and why.

The fallback is the interesting part. When Docker is missing or the container is
stopped, commands run on the HOST rather than failing. That is a deliberate
trade: the files are on the host mount either way, so refusing to run anything
would make a missing daemon fatal to a feature that mostly does not need one.

Because that means a command can run somewhere the operator did not expect,
every path here must also produce a reason saying so.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.agent.exec_context import DockerExec, LocalExec
from app.core.config import Settings
from app.projects import execution
from app.projects.containers import ContainerState, DockerUnavailableError

PROJECT_ID = "6f1b2c9e-0000-4a11-9f2c-abc123456789"


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(anthropic_api_key="k", workspace_root=tmp_path)


@pytest.mark.asyncio
async def test_no_project_means_the_host(settings: Settings) -> None:
    """A plain chat behaves exactly as it did before containers existed."""
    resolved = await execution.resolve_executor(settings, None)
    assert isinstance(resolved.executor, LocalExec)
    assert resolved.containerised is False
    assert "host" in resolved.reason.lower()


@pytest.mark.asyncio
async def test_missing_docker_falls_back_to_the_host(
    settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _boom(*_a, **_k):
        raise DockerUnavailableError("no daemon")

    monkeypatch.setattr(execution, "status", _boom)

    resolved = await execution.resolve_executor(settings, PROJECT_ID)
    assert isinstance(resolved.executor, LocalExec)
    assert resolved.containerised is False
    # The operator is told what to do about it, not just that it failed.
    assert "Docker Desktop" in resolved.reason


@pytest.mark.asyncio
async def test_stopped_container_falls_back_and_says_so(
    settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _stopped(*_a, **_k):
        return ContainerState(
            exists=True, running=False, container_id="abc", status="exited"
        )

    monkeypatch.setattr(execution, "status", _stopped)

    resolved = await execution.resolve_executor(settings, PROJECT_ID)
    assert isinstance(resolved.executor, LocalExec)
    assert "exited" in resolved.reason


@pytest.mark.asyncio
async def test_running_container_is_used(
    settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _running(*_a, **_k):
        return ContainerState(
            exists=True, running=True, container_id="deadbeef", status="running"
        )

    async def _client(*_a, **_k):
        return object()

    monkeypatch.setattr(execution, "status", _running)
    monkeypatch.setattr(execution, "get_client", _client)

    resolved = await execution.resolve_executor(settings, PROJECT_ID)
    assert isinstance(resolved.executor, DockerExec)
    assert resolved.containerised is True
    assert "harness-project-" in resolved.reason


@pytest.mark.asyncio
async def test_running_container_without_an_id_is_not_trusted(
    settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    """running=True with no id is incoherent; fall back rather than guess."""

    async def _weird(*_a, **_k):
        return ContainerState(
            exists=True, running=True, container_id=None, status="running"
        )

    monkeypatch.setattr(execution, "status", _weird)

    resolved = await execution.resolve_executor(settings, PROJECT_ID)
    assert isinstance(resolved.executor, LocalExec)


@pytest.mark.asyncio
async def test_every_outcome_explains_itself(
    settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A command that runs somewhere unexpected must always be accounted for."""

    async def _stopped(*_a, **_k):
        return ContainerState(exists=False, running=False, status="removed")

    monkeypatch.setattr(execution, "status", _stopped)

    for project in (None, PROJECT_ID):
        resolved = await execution.resolve_executor(settings, project)
        assert resolved.reason.strip()
        assert resolved.reason.endswith(".")
