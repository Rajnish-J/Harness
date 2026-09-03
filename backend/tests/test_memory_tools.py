"""The `remember` tool: scope resolution, validation, and slug derivation.

No real database: memory_repo.upsert is monkeypatched, the same style
test_project_purge.py uses for its repo calls, since this suite has no test
database (see that file's own docstring).
"""

from datetime import datetime, timezone
from uuid import uuid4

import pytest

from app.agent.tools import memory_tools
from app.agent.tools.base import ToolExecutionError
from app.db.memory_repo import MemoryRow


def _fake_row(**overrides) -> MemoryRow:
    defaults = dict(
        id=uuid4(),
        project_id=None,
        kind="fact",
        slug="a-fact",
        title="A fact",
        content="Something true.",
        source="agent",
        session_id="sess-1",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    defaults.update(overrides)
    return MemoryRow(**defaults)


@pytest.fixture
def captured(monkeypatch: pytest.MonkeyPatch) -> dict:
    calls: dict = {}

    async def fake_upsert(_pool, **kwargs):
        calls["kwargs"] = kwargs
        return _fake_row(
            project_id=kwargs["project_id"], kind=kwargs["kind"], slug=kwargs["slug"]
        )

    monkeypatch.setattr(memory_tools.memory_repo, "upsert", fake_upsert)
    return calls


async def test_remember_defaults_to_project_scope(captured):
    result = await memory_tools.remember(
        title="Always run tests",
        content="Run pytest before committing.",
        pool=object(),
        project_id="proj-1",
        session_id="sess-1",
    )

    assert captured["kwargs"]["project_id"] == "proj-1"
    assert captured["kwargs"]["kind"] == "fact"
    assert "applies for this project" in result


async def test_remember_global_scope_ignores_project_id(captured):
    await memory_tools.remember(
        title="Prefers tabs",
        content="The user prefers tabs over spaces.",
        kind="preference",
        scope="global",
        pool=object(),
        project_id="proj-1",
        session_id="sess-1",
    )

    assert captured["kwargs"]["project_id"] is None
    assert captured["kwargs"]["kind"] == "preference"


async def test_remember_with_no_project_open_falls_back_to_global(captured):
    """Default scope='project' with no project open has nothing narrower to
    attach to, so it becomes a global row -- see memory_tools.py's docstring."""
    await memory_tools.remember(
        title="General preference",
        content="Something true regardless of project.",
        pool=object(),
        project_id=None,
        session_id="sess-1",
    )

    assert captured["kwargs"]["project_id"] is None


async def test_remember_derives_a_slug_from_the_title(captured):
    await memory_tools.remember(
        title="Always Run Tests First!",
        content="...",
        pool=object(),
    )

    assert captured["kwargs"]["slug"] == "always-run-tests-first"


async def test_remember_honours_an_explicit_slug(captured):
    await memory_tools.remember(
        title="Whatever",
        content="...",
        slug="custom-slug",
        pool=object(),
    )

    assert captured["kwargs"]["slug"] == "custom-slug"


async def test_remember_rejects_an_unknown_kind(captured):
    with pytest.raises(ToolExecutionError):
        await memory_tools.remember(
            title="Bad",
            content="...",
            kind="not-a-real-kind",
            pool=object(),
        )


async def test_remember_rejects_an_unknown_scope(captured):
    with pytest.raises(ToolExecutionError):
        await memory_tools.remember(
            title="Bad",
            content="...",
            scope="not-a-real-scope",
            pool=object(),
        )


async def test_remember_without_a_database_refuses_rather_than_crashing():
    with pytest.raises(ToolExecutionError):
        await memory_tools.remember(title="X", content="Y", pool=None)


def test_remember_tool_is_registered():
    from app.agent.tools.registry import TOOLS_BY_NAME

    assert memory_tools.REMEMBER_TOOL_NAME in TOOLS_BY_NAME
