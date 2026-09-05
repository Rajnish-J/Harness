"""The two tools that let a project's agent see its sibling conversations."""

from datetime import datetime, timezone

import pytest

from app.agent.tools.base import ToolExecutionError
from app.agent.tools.chat_tools import list_project_chats, read_project_chat
from app.db.project_chat_repo import SessionSummary

PROJECT = "44444444-4444-4444-4444-444444444444"
CURRENT = "sess-current"
SIBLING = "sess-sibling"


def summary(session_id: str, title: str, count: int = 4) -> SessionSummary:
    return SessionSummary(
        session_id=session_id,
        updated_at=datetime(2026, 9, 5, 12, 0, tzinfo=timezone.utc),
        message_count=count,
        title=title,
    )


@pytest.fixture
def stub(monkeypatch):
    """Patch the repo so these stay offline like the rest of the suite."""

    state = {
        "sessions": [summary(CURRENT, "Build the header"), summary(SIBLING, "Wire up auth")],
        "transcript": [
            {"role": "user", "content": "how does auth work?"},
            {"role": "assistant", "content": "It uses a bearer token."},
            {"role": "tool_call", "content": None, "tool_name": "read_file"},
            {"role": "tool_result", "content": "noise that should not appear"},
        ],
    }

    async def fake_list(pool, project_id, limit=50):
        return state["sessions"]

    async def fake_load(pool, session_id, *, limit=500):
        return state["transcript"]

    monkeypatch.setattr("app.db.project_chat_repo.list_sessions", fake_list)
    monkeypatch.setattr("app.db.project_chat_repo.load_transcript_for_session", fake_load)
    return state


async def test_lists_siblings_and_excludes_the_current_chat(stub):
    out = await list_project_chats(
        pool=object(), project_id=PROJECT, session_id=CURRENT
    )

    assert SIBLING in out
    assert "Wire up auth" in out
    assert CURRENT not in out, "the model does not need to be told about itself"


async def test_says_so_when_there_are_no_siblings(stub):
    stub["sessions"] = [summary(CURRENT, "Only one")]

    out = await list_project_chats(
        pool=object(), project_id=PROJECT, session_id=CURRENT
    )

    assert "only conversation" in out.lower()


async def test_listing_refuses_without_a_project(stub):
    """The global chat has no siblings, and listing every chat would leak."""
    with pytest.raises(ToolExecutionError, match="No project is open"):
        await list_project_chats(pool=object(), project_id=None, session_id=CURRENT)


async def test_listing_degrades_without_a_pool(stub):
    with pytest.raises(ToolExecutionError, match="not available"):
        await list_project_chats(pool=None, project_id=PROJECT, session_id=CURRENT)


async def test_reads_a_sibling_and_drops_tool_noise(stub):
    out = await read_project_chat(
        chat_id=SIBLING, pool=object(), project_id=PROJECT, session_id=CURRENT
    )

    assert "how does auth work?" in out
    assert "bearer token" in out
    assert "[tool] read_file" in out
    assert "noise that should not appear" not in out


async def test_refuses_a_session_from_another_project(stub):
    """Ids are not scoped by the loader, so membership is checked here."""
    with pytest.raises(ToolExecutionError, match="No conversation"):
        await read_project_chat(
            chat_id="sess-someone-elses",
            pool=object(),
            project_id=PROJECT,
            session_id=CURRENT,
        )


async def test_reading_refuses_without_a_project(stub):
    with pytest.raises(ToolExecutionError, match="No project is open"):
        await read_project_chat(
            chat_id=SIBLING, pool=object(), project_id=None, session_id=CURRENT
        )


async def test_the_argument_is_not_named_session_id(stub):
    """_dispatch_tool passes the current session as `session_id` to every tool.

    A parameter of that name would collide with it and the tool could never be
    invoked -- which is exactly what happened the first time this was written.
    """
    import inspect

    from app.agent.tools.chat_tools import READ_PROJECT_CHAT_TOOL

    params = inspect.signature(read_project_chat).parameters
    assert "session_id" not in params
    assert "chat_id" in params
    assert "session_id" not in READ_PROJECT_CHAT_TOOL.input_schema["properties"]
