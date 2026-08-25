"""Pydantic mirror of the JSONB graph document stored in `workflows.graph`.

This is the arbiter of the graph shape. `frontend/lib/workflow-types.ts` mirrors
it for editor ergonomics, but anything the frontend sends is re-validated here
before it can reach the compiler.

Pure module: no I/O, no LangGraph, no LLM.
"""

from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, field_validator

NodeType = Literal["agent", "condition"]
OnError = Literal["fail", "continue"]
Branch = Literal["true", "false"]

# React Flow node ids become LangGraph node names, so they must not collide with
# LangGraph's reserved names or contain characters that break its routing.
_RESERVED_NODE_IDS = {"__start__", "__end__", "START", "END"}


class Position(BaseModel):
    """Canvas coordinates. Round-tripped for React Flow; ignored by the compiler."""

    x: float = 0
    y: float = 0


class AgentNodeConfig(BaseModel):
    model_config = {"extra": "forbid"}

    prompt: str = Field(default="", max_length=20_000)
    # None or [] means "every registered tool".
    tools: list[str] | None = None
    max_iterations: int | None = Field(default=None, ge=1, le=50)
    on_error: OnError = "fail"
    # Reserved for per-node model selection (M3). Stored now so the JSONB
    # doesn't need migrating later.
    model: str | None = None


class ConditionNodeConfig(BaseModel):
    model_config = {"extra": "forbid"}

    # Validated structurally by workflow.conditions.validate_predicate — kept as
    # a raw dict here so a malformed predicate produces a ValidationIssue the
    # canvas can highlight, rather than an opaque pydantic error.
    predicate: dict[str, Any] = Field(default_factory=dict)


class WorkflowNode(BaseModel):
    model_config = {"extra": "ignore"}

    id: str = Field(min_length=1, max_length=100)
    type: NodeType
    label: str = Field(default="", max_length=200)
    position: Position = Field(default_factory=Position)
    config: dict[str, Any] = Field(default_factory=dict)

    @field_validator("id")
    @classmethod
    def _check_id(cls, value: str) -> str:
        if value in _RESERVED_NODE_IDS:
            raise ValueError(f"{value!r} is reserved by LangGraph")
        if not all(c.isalnum() or c in "-_" for c in value):
            raise ValueError(
                f"node id {value!r} may only contain letters, digits, '-' and '_'"
            )
        return value

    def agent_config(self) -> AgentNodeConfig:
        return AgentNodeConfig.model_validate(self.config)

    def condition_config(self) -> ConditionNodeConfig:
        return ConditionNodeConfig.model_validate(self.config)


class WorkflowEdge(BaseModel):
    model_config = {"extra": "ignore"}

    id: str = Field(default="", max_length=200)
    source: str
    target: str
    # Which outlet of a condition node this edge leaves from. React Flow calls
    # this `sourceHandle`; None for plain edges.
    branch: Branch | None = None


class WorkflowGraph(BaseModel):
    model_config = {"extra": "ignore"}

    nodes: list[WorkflowNode] = Field(default_factory=list)
    edges: list[WorkflowEdge] = Field(default_factory=list)

    def node_by_id(self) -> dict[str, WorkflowNode]:
        return {node.id: node for node in self.nodes}

    def outgoing(self, node_id: str) -> list[WorkflowEdge]:
        return [edge for edge in self.edges if edge.source == node_id]

    def incoming(self, node_id: str) -> list[WorkflowEdge]:
        return [edge for edge in self.edges if edge.target == node_id]


GraphDocument = Annotated[WorkflowGraph, "the parsed workflows.graph JSONB column"]
