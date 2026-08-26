"""The workflow execution API.

Contains no business logic: it validates the request, builds the graph, and
streams. Everything it needs a database for degrades to 503 when DATABASE_URL is
unset, so Milestone 1's chat keeps working standalone.
"""

import logging
from collections.abc import AsyncIterator
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import ValidationError

from app.agent.llm.factory import get_llm_client
from app.agent.tools.registry import ALL_TOOLS
from app.api.sse import SSE_HEADERS
from app.core.config import Settings, get_settings
from app.db import workflow_repo as repo
from app.models.events import DoneEvent, ErrorEvent, sse_comment
from app.models.workflow_api import (
    CancelResponse,
    RunWorkflowRequest,
    ToolInfo,
    ValidateGraphRequest,
    ValidateGraphResponse,
)
from app.models.workflow_events import WorkflowDoneEvent, WorkflowErrorEvent
from app.workflow.compiler import build_state_graph
from app.workflow.recorder import DatabaseRecorder
from app.workflow.runner import make_node_deps, run_workflow
from app.workflow.schema import WorkflowGraph
from app.workflow.validation import GraphInvalid, errors_only, validate_graph

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["workflows"])


def _require_db(request: Request):
    pool = getattr(request.app.state, "pool", None)
    if pool is None:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "db_unconfigured",
                "message": "DATABASE_URL is not set, so workflows are unavailable. "
                "Chat still works.",
            },
        )
    return pool


# --------------------------------------------------------------------------
# Stateless helpers — no database, no LLM
# --------------------------------------------------------------------------

@router.post("/workflows/validate", response_model=ValidateGraphResponse)
async def validate(
    payload: ValidateGraphRequest,
    settings: Settings = Depends(get_settings),
) -> ValidateGraphResponse:
    """Validate a graph document. Called by Next.js before every write."""
    try:
        graph = WorkflowGraph.model_validate(payload.graph)
    except ValidationError as exc:
        return ValidateGraphResponse(
            ok=False,
            issues=[
                {
                    "code": "malformed_graph",
                    "severity": "error",
                    "message": err.get("msg", "invalid"),
                    "node_id": None,
                    "edge_id": None,
                }
                for err in exc.errors()[:20]
            ],
        )

    issues = validate_graph(graph, max_nodes=settings.max_workflow_nodes)
    return ValidateGraphResponse(
        ok=not errors_only(issues), issues=[issue.to_dict() for issue in issues]
    )


@router.get("/workflows/tools", response_model=list[ToolInfo])
async def list_tools() -> list[ToolInfo]:
    """The tool palette for the node config panel."""
    return [
        ToolInfo(
            name=tool.name,
            description=tool.description,
            input_schema=tool.input_schema,
            group=tool.group,
        )
        for tool in ALL_TOOLS
    ]


# --------------------------------------------------------------------------
# Execution
# --------------------------------------------------------------------------

@router.post("/workflows/{workflow_id}/runs")
async def start_run(
    workflow_id: str,
    payload: RunWorkflowRequest,
    request: Request,
    settings: Settings = Depends(get_settings),
) -> StreamingResponse:
    pool = _require_db(request)
    return StreamingResponse(
        _run_stream(request, pool, workflow_id, payload, settings),
        media_type="text/event-stream",
        headers=SSE_HEADERS,
    )


async def _run_stream(
    request: Request,
    pool: Any,
    workflow_id: str,
    payload: RunWorkflowRequest,
    settings: Settings,
) -> AsyncIterator[str]:
    # Flush headers before the first (slow) LLM call so the client's reader
    # starts immediately.
    yield sse_comment("stream open")

    try:
        workflow = await repo.get_workflow(pool, workflow_id)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Failed to load workflow %s", workflow_id)
        yield WorkflowErrorEvent(
            message=f"Could not load the workflow: {exc}", code="db_error"
        ).to_sse()
        yield DoneEvent(reason="error").to_sse()
        return

    if workflow is None:
        yield WorkflowErrorEvent(
            message=f"Workflow {workflow_id} not found.", code="not_found"
        ).to_sse()
        yield DoneEvent(reason="error").to_sse()
        return

    try:
        graph_doc = WorkflowGraph.model_validate(workflow.graph)
    except ValidationError as exc:
        yield WorkflowErrorEvent(
            message="The stored graph is malformed.",
            code="malformed_graph",
            issues=[{"message": str(exc)[:500]}],
        ).to_sse()
        yield DoneEvent(reason="error").to_sse()
        return

    try:
        llm_client = get_llm_client(settings)
    except Exception as exc:  # noqa: BLE001
        yield WorkflowErrorEvent(
            message=f"LLM provider misconfigured: {exc}", code="config"
        ).to_sse()
        yield DoneEvent(reason="error").to_sse()
        return

    # The run row exists before frame one: the id names the sandbox directory,
    # the checkpoint thread, and the workflow_started frame.
    run_id_str = str(uuid4())
    await repo.create_run(
        pool,
        run_id=run_id_str,
        workflow_id=workflow_id,
        workflow_version=workflow.version,
        user_input=payload.input,
        graph_snapshot=workflow.graph,
    )

    recorder = DatabaseRecorder(pool, run_id_str, graph_doc)

    async def is_cancelled() -> bool:
        if await request.is_disconnected():
            return True
        return await repo.is_cancel_requested(pool, run_id_str)

    deps = make_node_deps(
        llm_client=llm_client,
        settings=settings,
        recorder=recorder,
        is_cancelled=is_cancelled,
    )

    try:
        builder = build_state_graph(
            graph_doc, deps, max_nodes=settings.max_workflow_nodes
        )
        compiled = builder.compile(checkpointer=request.app.state.checkpointer)
    except GraphInvalid as exc:
        await repo.finish_run(
            pool, run_id_str, status="error", done_reason="invalid",
            error="graph validation failed",
        )
        yield WorkflowErrorEvent(
            message="The workflow graph is not valid.",
            code="graph_invalid",
            issues=[issue.to_dict() for issue in exc.issues],
        ).to_sse()
        yield WorkflowDoneEvent(run_id=run_id_str, reason="invalid").to_sse()
        return

    async for event in run_workflow(
        run_id=run_id_str,
        workflow_id=workflow_id,
        graph_doc=graph_doc,
        compiled=compiled,
        settings=settings,
        user_input=payload.input,
        recorder=recorder,
    ):
        yield event.to_sse()


@router.post("/runs/{run_id}/cancel", response_model=CancelResponse)
async def cancel_run(run_id: str, request: Request) -> CancelResponse:
    """Flag a run for cancellation.

    The flag lives in Postgres rather than process memory so it works across
    uvicorn workers and from a second browser tab. The running loop consults it
    between iterations, so cancellation lands within one LLM call.
    """
    pool = _require_db(request)
    cancelled = await repo.request_cancel(pool, run_id)
    return CancelResponse(ok=True, cancelled=cancelled)


@router.get("/workflows/{workflow_id}/runs")
async def run_history(
    workflow_id: str, request: Request, limit: int = 25
) -> list[dict[str, Any]]:
    pool = _require_db(request)
    return await repo.list_runs(pool, workflow_id, limit=min(limit, 100))


@router.get("/runs/{run_id}")
async def get_run(run_id: str, request: Request) -> dict[str, Any]:
    pool = _require_db(request)
    run = await repo.get_run(pool, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="run not found")
    run["steps"] = await repo.list_run_steps(pool, run_id)
    return run
