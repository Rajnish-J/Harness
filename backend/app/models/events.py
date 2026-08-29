from typing import Any, Literal

from pydantic import BaseModel


class AgentEvent(BaseModel):
    """Base for everything streamed to the client.

    Every frame is `data: {json}\\n\\n` with a `type` discriminator. The SSE
    `event:` field is deliberately unused — the browser's native EventSource is
    GET-only and we POST a JSON body, so the client parses frames by hand and
    switches on `type`.
    """

    type: str

    def to_sse(self) -> str:
        return f"data: {self.model_dump_json()}\n\n"


class ToolCallEvent(AgentEvent):
    type: Literal["tool_call"] = "tool_call"
    id: str
    name: str
    arguments: dict[str, Any]


class ToolResultEvent(AgentEvent):
    type: Literal["tool_result"] = "tool_result"
    id: str
    name: str
    is_error: bool
    content: str


class ApprovalRequestEvent(AgentEvent):
    """A tool call the loop will not run until the user says so.

    Emitted only in manual mode, one per call, immediately before the turn
    parks. Carries the same `id` the eventual `tool_result` will, so the client
    can fold the approval and its outcome into a single step.
    """

    type: Literal["approval_request"] = "approval_request"
    id: str
    name: str
    arguments: dict[str, Any]


class AssistantMessageEvent(AgentEvent):
    type: Literal["assistant_message"] = "assistant_message"
    text: str


class ErrorEvent(AgentEvent):
    type: Literal["error"] = "error"
    message: str
    code: str


class DoneEvent(AgentEvent):
    type: Literal["done"] = "done"
    reason: Literal[
        "end_turn",
        "max_iterations",
        "error",
        "disconnected",
        # Manual mode: the turn is parked on session.pending and resumes via
        # POST /api/chat/approve. Terminal for THIS stream, not for the turn.
        "awaiting_approval",
    ]
    # Accumulated across every LLM call made during this turn. None when no
    # call completed (e.g. the very first call errored).
    usage: dict[str, int] | None = None


def sse_comment(text: str) -> str:
    """A no-op SSE frame, used to flush headers and defeat proxy buffering."""
    return f": {text}\n\n"


def truncate_for_event(content: str, limit: int = 4000) -> str:
    """Keep a single tool result from flooding the UI with a whole file."""
    if len(content) <= limit:
        return content
    return content[:limit] + f"\n… [truncated {len(content) - limit} chars]"


__all__ = [
    "AgentEvent",
    "ToolCallEvent",
    "ToolResultEvent",
    "ApprovalRequestEvent",
    "AssistantMessageEvent",
    "ErrorEvent",
    "DoneEvent",
    "sse_comment",
    "truncate_for_event",
]
