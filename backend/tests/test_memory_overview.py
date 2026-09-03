"""The read-only insights endpoints: /api/memory/overview and /preview.

Repo layer monkeypatched, no test database — same approach as
test_memory_api.py and test_project_purge.py.

The preview test is the load-bearing one: it asserts the endpoint's block is
byte-identical to what `compose_system_prompt` produces, because a preview
that can drift from the real prompt is worse than showing nothing.
"""

from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.agent.loop import SYSTEM_PROMPT
from app.agent.prompt import compose_system_prompt
from app.api import memory as memory_api
from app.core.config import Settings
from app.db.memory_repo import MemoryRow
from app.db.project_chat_repo import SessionSummary


def _row(**overrides) -> MemoryRow:
    defaults = dict(
        id=uuid4(),
        project_id=None,
        kind="preference",
        slug="tabs-over-spaces",
        title="Prefers tabs",
        content="The user prefers tabs over spaces.",
        source="agent",
        session_id="session-a",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    defaults.update(overrides)
    return MemoryRow(**defaults)


def _summary(session_id: str, title: str) -> SessionSummary:
    return SessionSummary(
        session_id=session_id,
        updated_at=datetime.now(timezone.utc),
        message_count=4,
        title=title,
    )


@pytest.fixture
def settings() -> Settings:
    return Settings(anthropic_api_key="test-key")


@pytest.fixture
def request_with_pool() -> SimpleNamespace:
    return SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(pool=object())))


@pytest.fixture
def request_without_pool() -> SimpleNamespace:
    return SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(pool=None)))


# ------------------------------------------------------------------ overview


async def test_overview_returns_every_scope_and_resolves_sessions(
    request_with_pool, monkeypatch: pytest.MonkeyPatch
):
    rows = [
        _row(slug="global-one", session_id="session-a"),
        _row(slug="project-one", project_id=uuid4(), session_id="session-b"),
    ]

    async def fake_list_all(_pool):
        return rows

    async def fake_sessions(_pool, session_ids):
        assert sorted(session_ids) == ["session-a", "session-b"]
        return [_summary("session-a", "add the auth module")]

    monkeypatch.setattr(memory_api.memory_repo, "list_all", fake_list_all)
    monkeypatch.setattr(
        memory_api.project_chat_repo, "list_sessions_by_ids", fake_sessions
    )

    out = await memory_api.memory_overview(request_with_pool)

    assert [m.slug for m in out.memories] == ["global-one", "project-one"]
    # session-b produced a memory but no longer exists: absent, not an error.
    assert [s.session_id for s in out.sessions] == ["session-a"]
    assert out.sessions[0].title == "add the auth module"


async def test_overview_skips_the_session_query_when_nothing_is_agent_written(
    request_with_pool, monkeypatch: pytest.MonkeyPatch
):
    """Human-added memories carry no session_id, so there is nothing to look up."""

    async def fake_list_all(_pool):
        return [_row(source="human", session_id=None)]

    async def fake_sessions(_pool, session_ids):
        assert session_ids == []
        return []

    monkeypatch.setattr(memory_api.memory_repo, "list_all", fake_list_all)
    monkeypatch.setattr(
        memory_api.project_chat_repo, "list_sessions_by_ids", fake_sessions
    )

    out = await memory_api.memory_overview(request_with_pool)

    assert out.sessions == []
    assert len(out.memories) == 1


async def test_overview_503s_without_a_database(request_without_pool):
    with pytest.raises(HTTPException) as excinfo:
        await memory_api.memory_overview(request_without_pool)
    assert excinfo.value.status_code == 503


# ------------------------------------------------------------------- preview


async def test_preview_block_is_byte_identical_to_the_composed_prompt(
    request_with_pool, settings, monkeypatch: pytest.MonkeyPatch
):
    """The guard against the preview drifting from what the agent receives."""
    rows = [
        _row(slug="b-fact", kind="fact", content="Second."),
        _row(slug="a-feedback", kind="feedback", content="First."),
    ]

    async def fake_list_active(_pool, _project_id):
        return rows

    monkeypatch.setattr(memory_api.memory_repo, "list_active", fake_list_active)

    out = await memory_api.memory_preview(request_with_pool, settings=settings)

    composed = compose_system_prompt(base=SYSTEM_PROMPT, memories=rows)
    expected = composed[composed.index("<memories>") :]

    assert out.block == expected
    assert out.block.startswith("<memories>")
    assert out.block.endswith("</memories>")
    assert out.char_count == len(expected)
    assert out.memory_count == 2
    assert out.max_system_prompt_chars == settings.max_system_prompt_chars


async def test_preview_is_empty_when_nothing_is_in_scope(
    request_with_pool, settings, monkeypatch: pytest.MonkeyPatch
):
    """No memories means no block at all — not an empty <memories> element."""

    async def fake_list_active(_pool, _project_id):
        return []

    monkeypatch.setattr(memory_api.memory_repo, "list_active", fake_list_active)

    out = await memory_api.memory_preview(request_with_pool, settings=settings)

    assert out.block == ""
    assert out.char_count == 0
    assert out.memory_count == 0


async def test_preview_passes_the_project_scope_through(
    request_with_pool, settings, monkeypatch: pytest.MonkeyPatch
):
    seen: dict = {}

    async def fake_list_active(_pool, project_id):
        seen["project_id"] = project_id
        return []

    monkeypatch.setattr(memory_api.memory_repo, "list_active", fake_list_active)

    out = await memory_api.memory_preview(
        request_with_pool, project_id="proj-1", settings=settings
    )

    assert seen["project_id"] == "proj-1"
    assert out.project_id == "proj-1"


async def test_preview_503s_without_a_database(request_without_pool, settings):
    with pytest.raises(HTTPException) as excinfo:
        await memory_api.memory_preview(request_without_pool, settings=settings)
    assert excinfo.value.status_code == 503
