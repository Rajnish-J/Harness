"""SSE events for workflow runs.

Every class extends the existing AgentEvent, so `.to_sse()` is inherited and the
browser's frame parser needs no changes — a workflow stream is the same wire
format as a chat stream, just with more event types.
"""

from typing import Annotated, Any, Literal

from pydantic import Field

from app.models.events import (
    AgentEvent,
    AssistantMessageEvent,
    DoneEvent,
    ErrorEvent,
    ToolCallEvent,
    ToolResultEvent,
)

# A discriminated union, NOT the AgentEvent base class. Declaring `event:
# AgentEvent` would serialize with the base model's fields and silently drop
# every subclass field — `node_event` frames would arrive as {"type":"tool_call"}
# with no name and no arguments.
InnerAgentEvent = Annotated[
    ToolCallEvent | ToolResultEvent | AssistantMessageEvent | ErrorEvent | DoneEvent,
    Field(discriminator="type"),
]

DoneReason = Literal[
    "completed", "error", "cancelled", "recursion_limit", "disconnected", "invalid"
]


class WorkflowStartedEvent(AgentEvent):
    type: Literal["workflow_started"] = "workflow_started"
    run_id: str
    workflow_id: str
    node_ids: list[str]


class NodeStartedEvent(AgentEvent):
    type: Literal["node_started"] = "node_started"
    node_id: str
    node_type: str
    label: str = ""
    attempt: int = 1


class NodeEvent(AgentEvent):
    """Envelope carrying one inner agent event, tagged with its node."""

    type: Literal["node_event"] = "node_event"
    node_id: str
    event: InnerAgentEvent


class NodeFinishedEvent(AgentEvent):
    type: Literal["node_finished"] = "node_finished"
    node_id: str
    status: Literal["ok", "error", "skipped", "cancelled"]
    output_preview: str = ""
    error: str | None = None
    duration_ms: int = 0
    input_tokens: int | None = None
    output_tokens: int | None = None


class EdgeTakenEvent(AgentEvent):
    type: Literal["edge_taken"] = "edge_taken"
    source: str
    target: str
    branch: str | None = None


class WorkflowErrorEvent(AgentEvent):
    type: Literal["workflow_error"] = "workflow_error"
    message: str
    code: str
    node_id: str | None = None
    issues: list[dict[str, Any]] = Field(default_factory=list)


class WorkflowDoneEvent(AgentEvent):
    type: Literal["workflow_done"] = "workflow_done"
    run_id: str
    reason: DoneReason
    node_count: int = 0
    duration_ms: int = 0
