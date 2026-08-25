"""The condition node: evaluates a safe predicate and routes on the result.

Split into two pieces because LangGraph splits them: the *node* runs and records
a result (so the canvas can show it), then the *router* runs afterwards and only
picks an outlet. The router re-reads what the node wrote rather than evaluating
again, so the branch shown in the UI is guaranteed to be the branch taken.
"""

import logging
from datetime import datetime, timezone
from typing import Any

from langgraph.config import get_stream_writer

from app.workflow.conditions import evaluate
from app.workflow.nodes.agent_node import NodeDeps
from app.workflow.schema import WorkflowNode
from app.workflow.state import NodeOutput, WorkflowState

logger = logging.getLogger(__name__)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def make_condition_node(node: WorkflowNode, deps: NodeDeps):
    config = node.condition_config()

    async def run_node(state: WorkflowState) -> dict[str, Any]:
        writer = get_stream_writer()
        started_at = _now()

        if deps.on_node_start is not None:
            await deps.on_node_start(node.id, "")

        try:
            result = evaluate(config.predicate, dict(state))
            error: str | None = None
        except Exception as exc:  # noqa: BLE001 - a predicate must not kill a run
            logger.exception("Condition %s failed to evaluate", node.id)
            result = False
            error = str(exc)

        branch = "true" if result else "false"
        writer(
            {
                "node_id": node.id,
                "event": {
                    "type": "assistant_message",
                    "text": f"Condition evaluated to {branch}.",
                },
            }
        )

        output: NodeOutput = {
            "node_id": node.id,
            "node_type": "condition",
            "status": "error" if error else "ok",
            "text": branch,
            "branch": branch,
            "error": error,
            "started_at": started_at,
            "finished_at": _now(),
        }

        if deps.on_node_finish is not None:
            await deps.on_node_finish(
                node.id,
                {
                    "status": output["status"],
                    "output": branch,
                    "events": [],
                    "tool_call_count": 0,
                    "error": error,
                    "duration_ms": 0,
                },
            )

        return {"outputs": {node.id: output}}

    run_node.__name__ = f"condition_{node.id}"
    return run_node


def make_condition_router(node: WorkflowNode):
    """Return the branch this node already decided on.

    Reads state rather than re-evaluating: evaluating twice could disagree if
    state changed between the node and the router, and the canvas would then
    highlight an edge that wasn't taken.
    """

    def route(state: WorkflowState) -> str:
        output = (state.get("outputs") or {}).get(node.id) or {}
        return output.get("branch", "false")

    route.__name__ = f"route_{node.id}"
    return route
