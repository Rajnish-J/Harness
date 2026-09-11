"""The /api/chat/feedback routes.

Exercised directly with the repo layer monkeypatched, same reasoning as
test_memory_api.py: there is no test database, and what is worth pinning here
is the scoping, the slug derivation and the status codes -- not routing.

The slug tests are the load-bearing ones. `memory_repo.upsert` keys on slug, so
a slug derived from the note's title rather than from the message would make
every thumbs-down in a conversation collide on a single row, and the second
correction would silently erase the first.
"""

from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api import chat as chat_api
from app.db.feedback_repo import FeedbackRow
from app.db.memory_repo import MemoryRow
from app.api.chat import FeedbackNoteRequest, FeedbackRequest


def _feedback_row(**overrides) -> FeedbackRow:
    defaults = dict(
        id=uuid4(),
        session_id="sess-1",
        message_uid="msg_abc12345",
        vote="down",
        note=None,
        memory_id=None,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    defaults.update(overrides)
    return FeedbackRow(**defaults)


def _memory_row(**overrides) -> MemoryRow:
    defaults = dict(
        id=uuid4(),
        project_id=None,
        kind="feedback",
        slug="feedback-abc12345",
        title="What the user expected instead",
        content="...",
        source="human",
        session_id="sess-1",
        scoped_session_id="sess-1",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    defaults.update(overrides)
    return MemoryRow(**defaults)


@pytest.fixture
def request_with_pool() -> SimpleNamespace:
    return SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(pool=object())))


@pytest.fixture
def request_without_pool() -> SimpleNamespace:
    return SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(pool=None)))


# ----------------------------------------------------------------- the vote


async def test_a_vote_reaches_the_repo(
    request_with_pool, monkeypatch: pytest.MonkeyPatch
):
    seen: dict = {}

    async def fake_set(_pool, *, session_id, message_uid, vote):
        seen.update(session_id=session_id, message_uid=message_uid, vote=vote)
        return _feedback_row(vote=vote)

    monkeypatch.setattr(chat_api.feedback_repo, "set_vote", fake_set)

    out = await chat_api.set_message_feedback(
        FeedbackRequest(session_id="sess-1", message_uid="msg_abc12345", vote="up"),
        request_with_pool,
    )
    assert seen == {
        "session_id": "sess-1",
        "message_uid": "msg_abc12345",
        "vote": "up",
    }
    assert out.vote == "up"


async def test_a_null_vote_retracts_rather_than_storing_neutral(
    request_with_pool, monkeypatch: pytest.MonkeyPatch
):
    cleared: dict = {}

    async def fake_clear(_pool, message_uid):
        cleared["message_uid"] = message_uid
        return True

    async def fail(*_a, **_k):  # pragma: no cover - must not be reached
        raise AssertionError("a retraction must not write a vote")

    monkeypatch.setattr(chat_api.feedback_repo, "clear_vote", fake_clear)
    monkeypatch.setattr(chat_api.feedback_repo, "set_vote", fail)

    out = await chat_api.set_message_feedback(
        FeedbackRequest(session_id="sess-1", message_uid="msg_abc12345", vote=None),
        request_with_pool,
    )
    assert cleared["message_uid"] == "msg_abc12345"
    assert out.vote is None


async def test_retracting_a_vote_that_was_never_cast_is_not_a_404(
    request_with_pool, monkeypatch: pytest.MonkeyPatch
):
    """The user's intent is "no vote on this message", and that is now true
    whether or not there was one to remove."""

    async def fake_clear(_pool, _message_uid):
        return False

    monkeypatch.setattr(chat_api.feedback_repo, "clear_vote", fake_clear)

    out = await chat_api.set_message_feedback(
        FeedbackRequest(session_id="sess-1", message_uid="msg_abc12345", vote=None),
        request_with_pool,
    )
    assert out.vote is None


async def test_a_vote_without_a_database_is_503(request_without_pool):
    """Not a cheerful no-op: a thumb that reported success would stay lit
    until the next reload and then vanish."""
    with pytest.raises(HTTPException) as excinfo:
        await chat_api.set_message_feedback(
            FeedbackRequest(
                session_id="sess-1", message_uid="msg_abc12345", vote="up"
            ),
            request_without_pool,
        )
    assert excinfo.value.status_code == 503


# ----------------------------------------------------------------- the note


async def test_a_note_becomes_a_conversation_scoped_memory(
    request_with_pool, monkeypatch: pytest.MonkeyPatch
):
    seen: dict = {}

    async def fake_upsert(_pool, **kwargs):
        seen.update(kwargs)
        return _memory_row()

    async def fake_attach(_pool, *, message_uid, note, memory_id):
        return _feedback_row(note=note, memory_id=uuid4())

    monkeypatch.setattr(chat_api.memory_repo, "upsert", fake_upsert)
    monkeypatch.setattr(chat_api.feedback_repo, "attach_note", fake_attach)

    await chat_api.add_feedback_note(
        FeedbackNoteRequest(
            session_id="sess-1",
            message_uid="msg_abc12345",
            note="shorter answers please",
        ),
        request_with_pool,
    )

    assert seen["kind"] == "feedback"
    assert seen["source"] == "human"
    # The tier. Without this the memory would reach every chat in the project.
    assert seen["scoped_session_id"] == "sess-1"
    # The note itself must survive into the content the model will read.
    assert "shorter answers please" in seen["content"]


async def test_two_messages_get_two_slugs(
    request_with_pool, monkeypatch: pytest.MonkeyPatch
):
    """The overwrite trap. `upsert` keys on slug, so a slug that did not vary
    per message would make the second note replace the first."""
    slugs: list[str] = []

    async def fake_upsert(_pool, **kwargs):
        slugs.append(kwargs["slug"])
        return _memory_row()

    async def fake_attach(_pool, **_kwargs):
        return _feedback_row()

    monkeypatch.setattr(chat_api.memory_repo, "upsert", fake_upsert)
    monkeypatch.setattr(chat_api.feedback_repo, "attach_note", fake_attach)

    for uid in ("msg_aaaaaaaa", "msg_bbbbbbbb"):
        await chat_api.add_feedback_note(
            FeedbackNoteRequest(
                session_id="sess-1", message_uid=uid, note="do it differently"
            ),
            request_with_pool,
        )

    assert len(set(slugs)) == 2, slugs


async def test_the_same_message_keeps_one_slug(
    request_with_pool, monkeypatch: pytest.MonkeyPatch
):
    """Re-submitting for the same message should EDIT its memory, not add a
    second one -- a correction replacing a correction."""
    slugs: list[str] = []

    async def fake_upsert(_pool, **kwargs):
        slugs.append(kwargs["slug"])
        return _memory_row()

    async def fake_attach(_pool, **_kwargs):
        return _feedback_row()

    monkeypatch.setattr(chat_api.memory_repo, "upsert", fake_upsert)
    monkeypatch.setattr(chat_api.feedback_repo, "attach_note", fake_attach)

    for note in ("first try", "no, like this"):
        await chat_api.add_feedback_note(
            FeedbackNoteRequest(
                session_id="sess-1", message_uid="msg_abc12345", note=note
            ),
            request_with_pool,
        )

    assert len(set(slugs)) == 1, slugs


async def test_the_memory_is_written_before_the_note_is_attached(
    request_with_pool, monkeypatch: pytest.MonkeyPatch
):
    """Ordering is the honest part: the point of the note is the memory, so a
    note recorded without one would claim the model had been told something it
    had not."""
    order: list[str] = []

    async def fake_upsert(_pool, **_kwargs):
        order.append("memory")
        return _memory_row()

    async def fake_attach(_pool, **_kwargs):
        order.append("note")
        return _feedback_row()

    monkeypatch.setattr(chat_api.memory_repo, "upsert", fake_upsert)
    monkeypatch.setattr(chat_api.feedback_repo, "attach_note", fake_attach)

    await chat_api.add_feedback_note(
        FeedbackNoteRequest(
            session_id="sess-1", message_uid="msg_abc12345", note="x"
        ),
        request_with_pool,
    )
    assert order == ["memory", "note"]


async def test_a_note_for_a_retracted_vote_is_404(
    request_with_pool, monkeypatch: pytest.MonkeyPatch
):
    async def fake_upsert(_pool, **_kwargs):
        return _memory_row()

    async def fake_attach(_pool, **_kwargs):
        return None

    monkeypatch.setattr(chat_api.memory_repo, "upsert", fake_upsert)
    monkeypatch.setattr(chat_api.feedback_repo, "attach_note", fake_attach)

    with pytest.raises(HTTPException) as excinfo:
        await chat_api.add_feedback_note(
            FeedbackNoteRequest(
                session_id="sess-1", message_uid="msg_abc12345", note="x"
            ),
            request_with_pool,
        )
    assert excinfo.value.status_code == 404
