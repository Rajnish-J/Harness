"""Drive a compiled graph and turn its stream into SSE events.

The only module that calls `astream`. Keeps no state of its own: run and step
recording go through callbacks so the same runner works with or without a
database behind it.
"""

import logging
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any, Protocol

from app.core.config import Settings
from app.models.events import AgentEvent, truncate_for_event
from app.models.workflow_events import (
    EdgeTakenEvent,
    NodeEvent,
    NodeFinishedEvent,
    NodeStartedEvent,
    WorkflowDoneEvent,
    WorkflowErrorEvent,
    WorkflowStartedEvent,
)
from app.workflow.nodes.agent_node import NodeDeps, NodeFailed
from app.workflow.schema import WorkflowGraph
from app.workflow.state import initial_state
from app.workflow.stream_adapter import STREAM_MODES, normalize_chunk
from app.workflow.validation import GraphInvalid

logger = logging.getLogger(__name__)


class RunRecorder(Protocol):
    """How the runner reports progress. A no-op implementation is fine."""

    async def node_started(self, node_id: str, prompt: str) -> None: ...
    async def node_finished(self, node_id: str, result: dict[str, Any]) -> None: ...
    async def run_finished(
        self, *, status: str, reason: str, error: str | None, final_state: Any
    ) -> None: ...


class NullRecorder:
    async def node_started(self, node_id: str, prompt: str) -> None: ...
    async def node_finished(self, node_id: str, result: dict[str, Any]) -> None: ...
    async def run_finished(self, **kwargs: Any) -> None: ...


async def run_workflow(
    *,
    run_id: str,
    workflow_id: str,
    graph_doc: WorkflowGraph,
    compiled: Any,
    settings: Settings,
    user_input: str,
    recorder: RunRecorder | None = None,
    resume: bool = False,
) -> AsyncIterator[AgentEvent]:
    """Execute one workflow run, yielding SSE-ready events.

    Like `run_agent_loop`, every terminating path emits its own terminal event
    rather than using a `finally` — yielding during generator close raises, and
    a disconnect closes this generator.
    """
    recorder = recorder or NullRecorder()
    started = time.monotonic()
    node_ids = [node.id for node in graph_doc.nodes]
    node_types = {node.id: node.type for node in graph_doc.nodes}
    labels = {node.id: (node.label or node.id) for node in graph_doc.nodes}

    yield WorkflowStartedEvent(
        run_id=run_id, workflow_id=workflow_id, node_ids=node_ids
    )

    config = {
        "configurable": {"thread_id": run_id},
        "recursion_limit": settings.max_workflow_supersteps,
    }
    # Resuming passes None so LangGraph continues from the checkpoint rather
    # than restarting the graph.
    graph_input = None if resume else initial_state(run_id, user_input)

    started_nodes: set[str] = set()
    finished_nodes: set[str] = set()
    attempts: dict[str, int] = {}
    reason = "completed"
    error_message: str | None = None
    final_state: Any = None

    def edges_from(node_id: str, branch: str | None) -> list[EdgeTakenEvent]:
        events = []
        for edge in graph_doc.outgoing(node_id):
            if node_types.get(node_id) == "condition" and edge.branch != branch:
                continue
            events.append(
                EdgeTakenEvent(
                    source=edge.source, target=edge.target, branch=edge.branch
                )
            )
        return events

    try:
        async for chunk in compiled.astream(
            graph_input, config=config, stream_mode=STREAM_MODES
        ):
            normalized = normalize_chunk(chunk)
            if normalized is None:
                logger.warning("Unrecognized stream chunk shape: %r", type(chunk))
                continue
            mode, payload = normalized

            if mode == "custom":
                node_id = payload.get("node_id")
                inner = payload.get("event")
                if not node_id or not isinstance(inner, dict):
                    continue

                # The first event from a node is how we know it started; there
                # is no separate LangGraph "node started" signal.
                if node_id not in started_nodes:
                    started_nodes.add(node_id)
                    attempts[node_id] = attempts.get(node_id, 0) + 1
                    yield NodeStartedEvent(
                        node_id=node_id,
                        node_type=node_types.get(node_id, "agent"),
                        label=labels.get(node_id, node_id),
                        attempt=attempts[node_id],
                    )

                yield NodeEvent(node_id=node_id, event=inner)

            elif mode == "updates":
                # {node_id: {channel: value}} for everything that finished this
                # super-step.
                for node_id, update in (payload or {}).items():
                    outputs = (update or {}).get("outputs") or {}
                    output = outputs.get(node_id) or {}
                    if not output:
                        continue
                    finished_nodes.add(node_id)
                    yield NodeFinishedEvent(
                        node_id=node_id,
                        status=output.get("status", "ok"),
                        output_preview=truncate_for_event(
                            output.get("text", ""), limit=400
                        ),
                        error=output.get("error"),
                        duration_ms=0,
                    )
                    for event in edges_from(node_id, output.get("branch")):
                        yield event

    except NodeFailed as exc:
        reason = "error"
        error_message = str(exc)
        yield WorkflowErrorEvent(
            message=f"Node {exc.node_id!r} failed: {exc}",
            code="node_failed",
            node_id=exc.node_id,
        )
    except GraphInvalid as exc:
        reason = "invalid"
        error_message = str(exc)
        yield WorkflowErrorEvent(
            message="The workflow graph is not valid.",
            code="graph_invalid",
            issues=[issue.to_dict() for issue in exc.issues],
        )
    except Exception as exc:  # noqa: BLE001 - the stream must always close cleanly
        name = type(exc).__name__
        if "Recursion" in name or "recursion" in str(exc).lower():
            reason = "recursion_limit"
            message = (
                f"Workflow exceeded {settings.max_workflow_supersteps} super-steps. "
                "Check for a cycle that never exits."
            )
        else:
            reason = "error"
            message = f"Workflow failed: {exc}"
        logger.exception("Workflow run %s failed", run_id)
        error_message = message
        yield WorkflowErrorEvent(message=message, code=name)

    status = {"completed": "completed", "invalid": "error"}.get(reason, reason)
    try:
        await recorder.run_finished(
            status="completed" if reason == "completed" else status,
            reason=reason,
            error=error_message,
            final_state=final_state,
        )
    except Exception:  # noqa: BLE001 - recording must not break the stream
        logger.exception("Failed to record run completion for %s", run_id)

    yield WorkflowDoneEvent(
        run_id=run_id,
        reason=reason,
        node_count=len(finished_nodes),
        duration_ms=int((time.monotonic() - started) * 1000),
    )


def make_node_deps(
    *,
    llm_client: Any,
    settings: Settings,
    recorder: RunRecorder,
    is_cancelled: Callable[[], Awaitable[bool]] | None = None,
) -> NodeDeps:
    return NodeDeps(
        llm_client=llm_client,
        settings=settings,
        is_cancelled=is_cancelled,
        on_node_start=recorder.node_started,
        on_node_finish=recorder.node_finished,
    )
