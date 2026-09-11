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


class ToolSelectionEvent(AgentEvent):
    """Which tools this turn was narrowed to, and why.

    Emitted once, before the loop's first decision, whenever a turn could have
    been narrowed -- including when it was not. `ran=False` with a `note` is how
    a fail-open is made visible: the router going quiet must not look like it
    simply chose everything.

    `selected` carries the group alongside each name so the transcript can show
    the same section labels the composer and /tools use, without the client
    having to re-fetch the catalog to look them up.
    """

    type: Literal["tool_selection"] = "tool_selection"
    #: Shared with the transcript row this becomes, so a reload can fold the
    #: persisted args back into the same step.
    id: str
    selected: list[dict[str, str]]
    pool_size: int
    reason: str = ""
    ran: bool = False
    note: str | None = None
    #: The model that did the choosing, or None when nothing ran.
    model: str | None = None


class McpConsentEvent(AgentEvent):
    """The turn needs an MCP server it is not allowed to use yet.

    Registering a server on /mcp does not attach it to a chat, so a request
    that needs one used to reach a model that had never heard of it -- and the
    model apologised for a capability the user had already set up. The router
    now sees every enabled server's catalog and says so before the turn runs.

    This parks EARLIER than the proposal events below: nothing has been
    appended to `session.history` yet, so declining leaves no half-turn behind
    and the pending message is simply dropped. Approving re-posts the same
    message with the server attached.

    `missing=True` means nothing registered can serve the request at all. There
    is then nothing to approve, and the card offers the /mcp catalog instead.
    """

    type: Literal["mcp_consent"] = "mcp_consent"
    id: str
    #: `{"id": ..., "name": ...}` per offered server. Empty when `missing`.
    servers: list[dict[str, str]] = []
    #: The router's own justification, shown so the ask is never unexplained.
    reason: str = ""
    missing: bool = False


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


class ProjectProposalEvent(AgentEvent):
    """The model wants to create a new blank project; a human must say yes.

    Emitted instead of ApprovalRequestEvent for a propose_create_project call,
    in every tool mode -- creating a project is a one-way door, so this park
    is never optional the way manual-mode approval is. Carries the same `id`
    the eventual `tool_result` will, exactly like ApprovalRequestEvent.
    """

    type: Literal["project_proposal"] = "project_proposal"
    id: str
    name: str
    description: str
    #: The scaffold the model suggested, or "" if it did not pick one. Empty
    #: rather than "blank" so "the model was silent" stays distinguishable from
    #: "the model chose blank" -- the card defaults, but the two are not the
    #: same signal.
    template: str = ""


class AttachProposalEvent(AgentEvent):
    """The model wants to file THIS conversation under an existing project.

    The sibling of ProjectProposalEvent: that one creates a new workspace, this
    one adopts an existing one. Force-parked for the same reason -- the move is
    reversible, unlike creating a project, but it must never happen silently.

    Its own event rather than a mode flag on ProjectProposalEvent: that event's
    card creates a project (name, description, template picker), and every one
    of those fields would become conditionally meaningful under a discriminator.
    """

    type: Literal["attach_proposal"] = "attach_proposal"
    id: str
    project_id: str
    #: Resolved server-side from project_id rather than taken from the model, so
    #: the card shows a name instead of a uuid and an invented id is caught
    #: before it can be offered to a human.
    project_name: str
    reason: str = ""


class AssistantMessageEvent(AgentEvent):
    type: Literal["assistant_message"] = "assistant_message"
    text: str
    #: Stable identity for this message, minted by the agent loop.
    #:
    #: The browser's own transcript ids are a render-time counter, and a
    #: reloaded transcript numbers its rows by `seq` instead -- two schemes
    #: that never agree, so anything keyed on them (a thumbs-up, say) detaches
    #: the moment the page reloads. This id is generated once, streamed here,
    #: and persisted alongside the message, so both paths name it identically.
    #:
    #: Required, not optional: every emitter is in this repository, and a
    #: default would let one of them quietly stop sending it and strand the
    #: feedback that points at it.
    message_uid: str


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
    "ToolSelectionEvent",
    "ApprovalRequestEvent",
    "McpConsentEvent",
    "ProjectProposalEvent",
    "AttachProposalEvent",
    "AssistantMessageEvent",
    "ErrorEvent",
    "DoneEvent",
    "sse_comment",
    "truncate_for_event",
]
