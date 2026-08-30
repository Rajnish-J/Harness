"""Purging a deleted project's container, index and checkout.

The endpoint is exercised directly rather than through an HTTP client: nothing
else in `app/api/` has route-level tests, there is no test database, and the
behaviour worth pinning here is not routing but ordering and failure tolerance —
above all that a machine with no Docker daemon still gets its disk back.
"""

from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.api import projects as projects_api
from app.core.config import Settings
from app.db.project_repo import ProjectRow
from app.projects.containers import DockerUnavailableError
from app.projects.workspaces import project_workspace

PROJECT_ID = "6f1b2c9e-0000-4a11-9f2c-abc123456789"


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(anthropic_api_key="test-key", workspace_root=tmp_path)


@pytest.fixture
def request_with_pool() -> SimpleNamespace:
    """The shape `_require_pool` reads: request.app.state.pool."""
    return SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(pool=object())))


@pytest.fixture
def calls(monkeypatch: pytest.MonkeyPatch) -> dict:
    """Record the DB writes, and default to a project that exists."""
    seen: dict = {"forget": [], "files": []}

    async def fake_get(_pool, project_id):
        return seen.get(
            "project",
            ProjectRow(
                id=project_id,
                name="HW",
                slug="hw",
                provider="github",
                repo_owner="octocat",
                repo_name="Hello-World",
                repo_url="https://github.com/octocat/Hello-World.git",
                default_branch="master",
                credential_id=None,
                clone_status="ready",
                current_branch="master",
            ),
        )

    async def fake_forget(_pool, project_id):
        seen["forget"].append(project_id)

    async def fake_replace(_pool, project_id, files):
        seen["files"].append((project_id, list(files)))
        return 0

    monkeypatch.setattr(projects_api, "get_project_any_state", fake_get)
    monkeypatch.setattr(projects_api.container_repo, "forget", fake_forget)
    monkeypatch.setattr(projects_api, "replace_project_files", fake_replace)
    return seen


def _seed_checkout(settings: Settings) -> Path:
    """A checkout with a read-only file, the way git leaves .git/objects."""
    workspace = project_workspace(settings, PROJECT_ID)
    (workspace / "README.md").write_text("# HW\n", encoding="utf-8")
    return workspace


async def test_purge_removes_container_index_and_checkout(
    settings, request_with_pool, calls, monkeypatch
):
    async def fake_remove(project_id):
        calls["removed_container"] = project_id

    monkeypatch.setattr(projects_api, "remove_container", fake_remove)
    workspace = _seed_checkout(settings)
    assert workspace.exists()

    result = await projects_api.purge_project(PROJECT_ID, request_with_pool, settings)

    assert result.workspace_removed is True
    assert result.container_removed is True
    assert not workspace.parent.exists()
    assert calls["removed_container"] == PROJECT_ID
    assert calls["forget"] == [PROJECT_ID]
    # The index is cleared, not left describing files that no longer exist.
    assert calls["files"] == [(PROJECT_ID, [])]


async def test_purge_reclaims_disk_when_docker_is_unavailable(
    settings, request_with_pool, calls, monkeypatch
):
    """The case that actually happens here: Docker Desktop's engine won't start.

    A 503 would make delete permanently useless on such a machine, so the
    container failure is demoted to a note and the checkout still goes.
    """

    async def fake_remove(_project_id):
        raise DockerUnavailableError("Docker is not running.")

    monkeypatch.setattr(projects_api, "remove_container", fake_remove)
    workspace = _seed_checkout(settings)

    result = await projects_api.purge_project(PROJECT_ID, request_with_pool, settings)

    assert result.workspace_removed is True
    assert result.container_removed is False
    assert "Docker" in result.message
    assert not workspace.parent.exists()
    # The cached row still goes: it describes a container we can no longer see.
    assert calls["forget"] == [PROJECT_ID]


async def test_purge_is_a_no_op_on_an_already_removed_checkout(
    settings, request_with_pool, calls, monkeypatch
):
    async def fake_remove(_project_id):
        return None

    monkeypatch.setattr(projects_api, "remove_container", fake_remove)

    result = await projects_api.purge_project(PROJECT_ID, request_with_pool, settings)

    assert result.workspace_removed is True


async def test_purge_succeeds_for_an_archived_project(
    settings, request_with_pool, calls, monkeypatch
):
    """The whole reason `get_project_any_state` exists.

    Purge runs after the row has been archived, so a lookup that filtered
    `archived_at is null` would 404 on every real delete.
    """

    async def fake_remove(_project_id):
        return None

    monkeypatch.setattr(projects_api, "remove_container", fake_remove)
    workspace = _seed_checkout(settings)

    # get_project would return None here; get_project_any_state must not.
    result = await projects_api.purge_project(PROJECT_ID, request_with_pool, settings)

    assert result.workspace_removed is True
    assert not workspace.parent.exists()


async def test_purge_404s_on_an_unknown_project(
    settings, request_with_pool, calls, monkeypatch
):
    calls["project"] = None

    async def fake_remove(_project_id):  # pragma: no cover - must not be reached
        raise AssertionError("the container should not be touched for an unknown id")

    monkeypatch.setattr(projects_api, "remove_container", fake_remove)

    with pytest.raises(HTTPException) as excinfo:
        await projects_api.purge_project(PROJECT_ID, request_with_pool, settings)

    assert excinfo.value.status_code == 404


async def test_purge_rejects_an_unsafe_project_id(
    settings, request_with_pool, calls, monkeypatch
):
    async def fake_remove(_project_id):
        return None

    monkeypatch.setattr(projects_api, "remove_container", fake_remove)

    with pytest.raises(HTTPException) as excinfo:
        await projects_api.purge_project("../escape", request_with_pool, settings)

    assert excinfo.value.status_code == 400
