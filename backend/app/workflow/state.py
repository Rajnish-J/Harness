"""The LangGraph state channel and its reducers.

Pure module: no I/O, no LangGraph import, no LLM.
"""

import operator
from typing import Annotated, Literal, NotRequired, TypedDict

NodeStatus = Literal["ok", "error", "skipped", "cancelled"]


class NodeOutput(TypedDict):
    """What one finished node contributes to shared state.

    `text` is TRUNCATED. Every super-step serializes the entire state into a
    checkpoint row, so putting full transcripts here would mean tens of MB per
    run and a visibly sluggish graph. The untruncated output goes to
    `workflow_run_steps.output` instead.
    """

    node_id: str
    node_type: str
    status: NodeStatus
    text: str
    branch: NotRequired[str]
    error: NotRequired[str | None]
    done_reason: NotRequired[str | None]
    tool_calls: NotRequired[int]
    started_at: str
    finished_at: str


def merge_outputs(
    left: dict[str, NodeOutput], right: dict[str, NodeOutput]
) -> dict[str, NodeOutput]:
    """Shallow dict merge. THE load-bearing reducer.

    Without it, two nodes finishing in the same super-step both write the
    `outputs` channel and LangGraph raises InvalidUpdateError — at runtime, in
    the specific super-step where the collision happens. That means a workflow
    can pass every sequential test and blow up the first time someone drags a
    second branch onto the canvas. Verified empirically before this was written.
    """
    if not right:
        return left
    return {**left, **right}


class WorkflowState(TypedDict):
    """State shared across every node in a run."""

    run_id: str
    input: str
    outputs: Annotated[dict[str, NodeOutput], merge_outputs]
    errors: Annotated[list[str], operator.add]


def initial_state(run_id: str, user_input: str) -> WorkflowState:
    return {"run_id": run_id, "input": user_input, "outputs": {}, "errors": []}


def truncate_for_state(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    return text[:limit] + f"\n… [truncated {len(text) - limit} chars]"
