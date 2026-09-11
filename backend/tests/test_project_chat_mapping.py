"""Which streamed events become transcript rows.

`_entry_for` decides what a project's chat remembers. Getting it wrong is
invisible until someone reloads a page and finds half a conversation, so the
mapping is pinned here rather than left to the integration path.
"""

from app.api.chat import _entry_for, _stamp_usage
from app.db.project_chat_repo import TranscriptEntry
from app.models.events import (
    ApprovalRequestEvent,
    AssistantMessageEvent,
    DoneEvent,
    ErrorEvent,
    ToolCallEvent,
    ToolResultEvent,
)


def test_assistant_text_is_kept() -> None:
    entry = _entry_for(
        AssistantMessageEvent(text="here is the plan", message_uid="msg_abc")
    )
    assert entry is not None
    assert entry.role == "assistant"
    assert entry.content == "here is the plan"


def test_assistant_message_carries_its_uid_to_the_row() -> None:
    """The id the browser saw must be the id that lands in the database.

    This is the whole mechanism behind feedback surviving a reload: drop it
    here and a thumbs-up points at a message the reloaded page cannot name.
    """
    entry = _entry_for(
        AssistantMessageEvent(text="hello", message_uid="msg_deadbeef")
    )
    assert entry is not None
    assert entry.message_uid == "msg_deadbeef"


def test_tool_call_keeps_the_id_so_a_result_can_fold_into_it() -> None:
    entry = _entry_for(
        ToolCallEvent(id="call_1", name="read_file", arguments={"path": "a.py"})
    )
    assert entry is not None
    assert entry.role == "tool_call"
    assert entry.tool_call_id == "call_1"
    assert entry.tool_name == "read_file"
    assert entry.tool_args == {"path": "a.py"}


def test_tool_result_carries_the_same_id() -> None:
    entry = _entry_for(
        ToolResultEvent(id="call_1", name="read_file", content="ok", is_error=False)
    )
    assert entry is not None
    assert entry.role == "tool_result"
    assert entry.tool_call_id == "call_1"
    assert entry.is_error is False


def test_a_failed_tool_is_recorded_as_failed() -> None:
    """The transcript must not repaint an error as a success."""
    entry = _entry_for(
        ToolResultEvent(id="c", name="run_command", content="boom", is_error=True)
    )
    assert entry is not None
    assert entry.is_error is True


def test_errors_are_kept() -> None:
    entry = _entry_for(ErrorEvent(message="provider is down", code="llm"))
    assert entry is not None
    assert entry.role == "error"
    assert entry.content == "provider is down"


def test_done_is_not_a_transcript_line() -> None:
    """`done` is stream bookkeeping; it was never rendered as a message."""
    assert _entry_for(DoneEvent(reason="end_turn")) is None


def test_approval_request_is_not_persisted_on_its_own() -> None:
    """An approval becomes a step once its result arrives, so storing the
    request too would duplicate the line on reload."""
    assert (
        _entry_for(ApprovalRequestEvent(id="c", name="write_file", arguments={}))
        is None
    )


# --------------------------------------------------------------- token usage
#
# `done` carries the turn's accumulated token totals but is not itself a
# transcript line (see the test above), so _stamp_usage puts them on the
# assistant row that ended the turn instead.


def test_usage_lands_on_the_assistant_row() -> None:
    entries = [
        TranscriptEntry(role="user", content="hi"),
        TranscriptEntry(role="assistant", content="hello", message_uid="m1"),
    ]
    _stamp_usage(entries, {"input_tokens": 1200, "output_tokens": 340})
    assert entries[1].input_tokens == 1200
    assert entries[1].output_tokens == 340
    # The user line is left alone -- it has no cost of its own.
    assert entries[0].input_tokens is None


def test_usage_lands_on_the_LAST_assistant_row() -> None:
    """A turn narrates before each tool call, so several assistant rows can
    share one turn. Only the closing one carries the turn's cost; stamping the
    first would attribute the whole turn to a sentence written before any of
    the work happened."""
    entries = [
        TranscriptEntry(role="assistant", content="let me look", message_uid="m1"),
        TranscriptEntry(role="tool_call", tool_name="read_file"),
        TranscriptEntry(role="tool_result", tool_name="read_file", content="ok"),
        TranscriptEntry(role="assistant", content="done", message_uid="m2"),
    ]
    _stamp_usage(entries, {"input_tokens": 10, "output_tokens": 2})
    assert entries[0].input_tokens is None
    assert entries[3].input_tokens == 10
    assert entries[3].output_tokens == 2


def test_no_usage_is_a_silent_no_op() -> None:
    """The first LLM call erroring leaves nothing to report, and a transcript
    with zeroes in it would claim the turn was free rather than unmeasured."""
    entries = [TranscriptEntry(role="assistant", content="hi", message_uid="m1")]
    _stamp_usage(entries, None)
    assert entries[0].input_tokens is None
    assert entries[0].output_tokens is None


def test_usage_with_no_assistant_row_is_a_silent_no_op() -> None:
    """A turn can end with no assistant text at all (the loop only emits the
    message when `turn.text` is non-empty). There is nowhere to put the totals,
    and inventing a row for them would mean a new chat_role value."""
    entries = [
        TranscriptEntry(role="user", content="hi"),
        TranscriptEntry(role="tool_call", tool_name="read_file"),
    ]
    _stamp_usage(entries, {"input_tokens": 5, "output_tokens": 1})
    assert all(e.input_tokens is None for e in entries)
