"""The agent node: a LangGraph node that runs the existing agent loop.

This is the seam of the whole milestone. LangGraph decides *when* this runs and
what state it sees; `run_agent_loop` — unchanged from Milestone 1 apart from an
optional tool subset — decides what the agent actually does.
"""

import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from langgraph.config import get_stream_writer

from app.agent.llm.base import LLMClient
from app.agent.loop import run_agent_loop
from app.agent.session import Session
from app.core.config import Settings
from app.workflow.schema import WorkflowNode
from app.workflow.state import NodeOutput, WorkflowState, truncate_for_state
from app.workflow.templating import render
from app.workflow.toolsets import resolve_toolset
from app.workflow.workspaces import settings_for_run

logger = logging.getLogger(__name__)


class NodeFailed(Exception):
    """An agent node failed and its config says to stop the run."""

    def __init__(self, node_id: str, message: str) -> None:
        super().__init__(message)
        self.node_id = node_id


@dataclass
class NodeDeps:
    """Everything a node factory needs that isn't in the graph document."""

    llm_client: LLMClient
    settings: Settings
    is_cancelled: Callable[[], Awaitable[bool]] | None = None
    # Called with (node_id, rendered_prompt) when a node starts, and with the
    # full result when it finishes. The runner uses these to write run steps.
    on_node_start: Callable[[str, str], Awaitable[Any]] | None = None
    on_node_finish: Callable[[str, dict[str, Any]], Awaitable[None]] | None = None


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def make_agent_node(node: WorkflowNode, deps: NodeDeps):
    """Build the callable LangGraph will invoke for this node."""
    config = node.agent_config()
    tools = resolve_toolset(config.tools)

    node_settings = deps.settings
    if config.max_iterations is not None:
        node_settings = node_settings.model_copy(
            update={"max_agent_iterations": config.max_iterations}
        )

    async def run_node(state: WorkflowState) -> dict[str, Any]:
        writer = get_stream_writer()
        started = time.monotonic()
        started_at = _now()

        # Each node gets the run's sandbox, not the global workspace, so two
        # concurrent runs cannot clobber each other's files.
        run_settings = settings_for_run(node_settings, state["run_id"])

        prompt = render(
            config.prompt,
            dict(state),
            max_chars=run_settings.max_interpolated_chars,
        )

        if deps.on_node_start is not None:
            await deps.on_node_start(node.id, prompt)

        # A fresh Session per node: nodes share state through the graph, not
        # through conversation history.
        session = Session(
            session_id=f"{state['run_id']}:{node.id}",
            provider=deps.llm_client.provider,
        )

        collected: list[dict[str, Any]] = []
        final_text = ""
        error: str | None = None
        done_reason: str | None = None
        tool_calls = 0

        async for event in run_agent_loop(
            session=session,
            llm_client=deps.llm_client,
            settings=run_settings,
            user_message=prompt,
            is_disconnected=deps.is_cancelled,
            tools=tools,
        ):
            payload = event.model_dump()
            collected.append(payload)
            # Must be a plain JSON-able dict: this also flows into checkpoint
            # pending-writes serialization.
            writer({"node_id": node.id, "event": payload})

            if event.type == "assistant_message":
                final_text = event.text
            elif event.type == "tool_call":
                tool_calls += 1
            elif event.type == "error":
                error = event.message
            elif event.type == "done":
                done_reason = event.reason

        # The loop returns silently on disconnect/cancel — no `done` event.
        cancelled = done_reason is None
        if cancelled:
            status = "cancelled"
        elif error is not None:
            status = "error"
        else:
            status = "ok"

        output: NodeOutput = {
            "node_id": node.id,
            "node_type": "agent",
            "status": status,
            "text": truncate_for_state(final_text, run_settings.max_node_output_chars),
            "error": error,
            "done_reason": done_reason,
            "tool_calls": tool_calls,
            "started_at": started_at,
            "finished_at": _now(),
        }

        if deps.on_node_finish is not None:
            await deps.on_node_finish(
                node.id,
                {
                    "status": status,
                    "output": final_text,  # untruncated; state gets the short one
                    "events": collected,
                    "tool_call_count": tool_calls,
                    "error": error,
                    "duration_ms": int((time.monotonic() - started) * 1000),
                },
            )

        update: dict[str, Any] = {"outputs": {node.id: output}}
        if error:
            update["errors"] = [f"{node.id}: {error}"]

        if status == "error" and config.on_error == "fail":
            # Raising aborts the graph. The runner catches this and reports the
            # run as errored, having already recorded this node's step row.
            raise NodeFailed(node.id, error or "node failed")

        return update

    run_node.__name__ = f"agent_{node.id}"
    return run_node
