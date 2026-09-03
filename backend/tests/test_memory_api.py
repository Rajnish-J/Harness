"""The /api/memory admin routes.

Exercised directly rather than through an HTTP client, and with the repo layer
monkeypatched -- same reasoning as test_project_purge.py: there is no test
database, and what is worth pinning here is scoping and status codes, not
routing.
"""

from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api import memory as memory_api
from app.db.memory_repo import MemoryRow
from app.models.memory import MemoryCreate, MemoryUpdate

MEMORY_ID = "6f1b2c9e-0000-4a11-9f2c-abc123456789"


def _row(**overrides) -> MemoryRow:
    defaults = dict(
        id=uuid4(),
        project_id=None,
        kind="fact",
        slug="a-fact",
        title="A fact",
        content="Something true.",
        source="human",
        session_id=None,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    defaults.update(overrides)
    return MemoryRow(**defaults)


@pytest.fixture
def request_with_pool() -> SimpleNamespace:
    """The shape `_require_pool` reads: request.app.state.pool."""
    return SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(pool=object())))


@pytest.fixture
def request_without_pool() -> SimpleNamespace:
    return SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(pool=None)))


async def test_list_passes_the_project_scope_through(
    request_with_pool, monkeypatch: pytest.MonkeyPatch
):
    seen: dict = {}

    async def fake_list(_pool, project_id):
        seen["project_id"] = project_id
        return [_row(), _row(project_id=uuid4(), slug="project-fact")]

    monkeypatch.setattr(memory_api.memory_repo, "list_active", fake_list)

    out = await memory_api.list_memory(request_with_pool, project_id="proj-1")

    assert seen["project_id"] == "proj-1"
    assert [m.slug for m in out] == ["a-fact", "project-fact"]


async def test_create_derives_a_slug_and_marks_the_source_human(
    request_with_pool, monkeypatch: pytest.MonkeyPatch
):
    seen: dict = {}

    async def fake_upsert(_pool, **kwargs):
        seen.update(kwargs)
        return _row(slug=kwargs["slug"])

    monkeypatch.setattr(memory_api.memory_repo, "upsert", fake_upsert)

    out = await memory_api.create_memory(
        MemoryCreate(title="Always Run Tests", content="Run pytest first."),
        request_with_pool,
    )

    assert seen["slug"] == "always-run-tests"
    assert seen["source"] == "human"
    assert out.slug == "always-run-tests"


async def test_update_404s_on_an_unknown_id(
    request_with_pool, monkeypatch: pytest.MonkeyPatch
):
    async def fake_update(_pool, _memory_id, **_kwargs):
        return None

    monkeypatch.setattr(memory_api.memory_repo, "update", fake_update)

    with pytest.raises(HTTPException) as excinfo:
        await memory_api.update_memory(
            MEMORY_ID, MemoryUpdate(title="New title"), request_with_pool
        )

    assert excinfo.value.status_code == 404


async def test_delete_archives_and_404s_when_nothing_was_archived(
    request_with_pool, monkeypatch: pytest.MonkeyPatch
):
    async def fake_archive(_pool, memory_id):
        return memory_id == MEMORY_ID

    monkeypatch.setattr(memory_api.memory_repo, "archive", fake_archive)

    assert await memory_api.delete_memory(MEMORY_ID, request_with_pool) == {"ok": True}

    with pytest.raises(HTTPException) as excinfo:
        await memory_api.delete_memory("some-other-id", request_with_pool)
    assert excinfo.value.status_code == 404


async def test_routes_503_without_a_database(request_without_pool):
    with pytest.raises(HTTPException) as excinfo:
        await memory_api.list_memory(request_without_pool)
    assert excinfo.value.status_code == 503
