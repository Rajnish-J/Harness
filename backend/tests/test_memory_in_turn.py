"""Memory reaching a turn — the whole point of the feature.

A memory written in one session must show up in the NEXT turn of any other
session in scope, without that session being told about it. `_prepare_turn`
re-reads memory and recomposes the system prompt on every request, so this
pins that read: given rows in the repo, the composed prompt carries them.

`mode="chat"` throughout: it short-circuits the MCP resolution branch, which
would otherwise need an app with a live McpManager on it. Nothing about the
memory path differs by mode.
"""

from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.api import chat as chat_api
from app.core.config import Settings
from app.db.memory_repo import MemoryRow
from app.models.chat import ChatRequest

PROJECT_ID = "6f1b2c9e-0000-4a11-9f2c-abc123456789"


def _row(**overrides) -> MemoryRow:
    defaults = dict(
        id=uuid4(),
        project_id=None,
        kind="preference",
        slug="tabs-over-spaces",
        title="Prefers tabs",
        content="The user prefers tabs over spaces.",
        source="agent",
        session_id="some-earlier-session",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    defaults.update(overrides)
    return MemoryRow(**defaults)


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(anthropic_api_key="test-key", workspace_root=tmp_path)


@pytest.fixture
def request_with_pool() -> SimpleNamespace:
    return SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(pool=object())))


@pytest.fixture
def request_without_pool() -> SimpleNamespace:
    return SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(pool=None)))


async def test_a_memory_written_elsewhere_reaches_this_turns_prompt(
    settings, request_with_pool, monkeypatch: pytest.MonkeyPatch
):
    """The cross-session guarantee: this session never saw that conversation."""

    async def fake_list(_pool, _project_id):
        return [_row()]

    monkeypatch.setattr(chat_api.memory_repo, "list_active", fake_list)

    turn, _ = await chat_api._prepare_turn(
        request_with_pool,
        ChatRequest(session_id="a-brand-new-session", message="hi", mode="chat"),
        settings,
    )

    assert "The user prefers tabs over spaces." in turn.system
    assert '<memory kind="preference" slug="tabs-over-spaces">' in turn.system


async def test_the_project_scope_is_passed_to_the_repo(
    settings, request_with_pool, monkeypatch: pytest.MonkeyPatch
):
    seen: dict = {}

    async def fake_list(_pool, project_id):
        seen["project_id"] = project_id
        return []

    async def fake_resolve_executor(_settings, _project_id):
        return SimpleNamespace(executor=None, reason=None)

    monkeypatch.setattr(chat_api.memory_repo, "list_active", fake_list)
    monkeypatch.setattr(chat_api, "resolve_executor", fake_resolve_executor)

    await chat_api._prepare_turn(
        request_with_pool,
        ChatRequest(
            session_id="s", message="hi", mode="chat", project_id=PROJECT_ID
        ),
        settings,
    )

    assert seen["project_id"] == PROJECT_ID


async def test_a_memory_failure_does_not_fail_the_turn(
    settings, request_with_pool, monkeypatch: pytest.MonkeyPatch
):
    """Memory is an enhancement, not a prerequisite — same contract as history."""

    async def exploding_list(_pool, _project_id):
        raise RuntimeError("postgres went away")

    monkeypatch.setattr(chat_api.memory_repo, "list_active", exploding_list)

    turn, _ = await chat_api._prepare_turn(
        request_with_pool,
        ChatRequest(session_id="s", message="hi", mode="chat"),
        settings,
    )

    assert turn.system.startswith(chat_api.SYSTEM_PROMPT.strip())
    assert "<memories>" not in turn.system


async def test_no_database_means_no_memory_block(settings, request_without_pool):
    turn, _ = await chat_api._prepare_turn(
        request_without_pool,
        ChatRequest(session_id="s", message="hi", mode="chat"),
        settings,
    )

    assert "<memories>" not in turn.system
    assert turn.pool is None


async def test_the_pool_and_scope_are_carried_on_the_turn(
    settings, request_with_pool, monkeypatch: pytest.MonkeyPatch
):
    """What the `remember` tool needs at dispatch time, resolved once here."""

    async def fake_list(_pool, _project_id):
        return []

    monkeypatch.setattr(chat_api.memory_repo, "list_active", fake_list)

    turn, _ = await chat_api._prepare_turn(
        request_with_pool,
        ChatRequest(session_id="s", message="hi", mode="chat"),
        settings,
    )

    assert turn.pool is request_with_pool.app.state.pool
    assert turn.project_id is None
