"""Which streamed events become transcript rows.

`_entry_for` decides what a project's chat remembers. Getting it wrong is
invisible until someone reloads a page and finds half a conversation, so the
mapping is pinned here rather than left to the integration path.
"""

from app.api.chat import _entry_for
from app.models.events import (
    ApprovalRequestEvent,
    AssistantMessageEvent,
    DoneEvent,
    ErrorEvent,
    ToolCallEvent,
    ToolResultEvent,
)


def test_assistant_text_is_kept() -> None:
    entry = _entry_for(AssistantMessageEvent(text="here is the plan"))
    assert entry is not None
    assert entry.role == "assistant"
    assert entry.content == "here is the plan"


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
