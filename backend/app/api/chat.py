import logging
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from app.agent.llm.factory import get_llm_client
from app.agent.loop import SYSTEM_PROMPT, run_agent_loop
from app.agent.prompt import compose_system_prompt
from app.agent.session import ProviderMismatchError, session_store
from app.agent.tools.toolsets import UnknownToolError, merge_toolsets
from app.api.sse import SSE_HEADERS
from app.core.config import Settings, get_settings
from app.mcp import resolve_mcp_tools
from app.models.chat import ChatRequest, ResetRequest
from app.models.events import DoneEvent, ErrorEvent, sse_comment

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["chat"])


@router.post("/chat")
async def chat(
    request: Request,
    payload: ChatRequest,
    settings: Settings = Depends(get_settings),
) -> StreamingResponse:
    """Run one agent turn, streaming each step back as it happens."""
    return StreamingResponse(
        _event_stream(request, payload, settings),
        media_type="text/event-stream",
        headers=SSE_HEADERS,
    )


async def _event_stream(
    request: Request,
    payload: ChatRequest,
    settings: Settings,
) -> AsyncIterator[str]:
    # Flush headers immediately so the client's reader starts before the first
    # (potentially slow) LLM call returns.
    yield sse_comment("stream open")

    # Per-turn overrides. model_copy skips validators, which is what makes this
    # cheap enough to do per request; same trick app/workflow/nodes/agent_node.py
    # uses for a node's iteration cap.
    overrides: dict[str, object] = {}
    if payload.model:
        key = (
            "anthropic_model"
            if settings.llm_provider == "anthropic"
            else "openai_model"
        )
        overrides[key] = payload.model
    if payload.max_iterations:
        overrides["max_agent_iterations"] = payload.max_iterations
    turn_settings = settings.model_copy(update=overrides) if overrides else settings

    try:
        # Built from turn_settings, not settings: the model name is baked into
        # the client's constructor, so this is the only seam for overriding it.
        llm_client = get_llm_client(turn_settings)
    except Exception as exc:  # noqa: BLE001 - misconfiguration, report to the UI
        logger.exception("Failed to build LLM client")
        yield ErrorEvent(message=f"LLM provider misconfigured: {exc}", code="config").to_sse()
        yield DoneEvent(reason="error").to_sse()
        return

    try:
        session = session_store.get_or_create(payload.session_id, llm_client.provider)
    except ProviderMismatchError as exc:
        yield ErrorEvent(message=str(exc), code="provider_mismatch").to_sse()
        yield DoneEvent(reason="error").to_sse()
        return

    system = compose_system_prompt(
        base=SYSTEM_PROMPT,
        agent_name=payload.agent_name,
        agent_prompt=payload.system_prompt,
        skills=payload.skills,
        max_chars=turn_settings.max_system_prompt_chars,
    )

    # MCP is resolved non-fatally: an unreachable server degrades the turn to
    # the built-in tools rather than failing it.
    mcp_tools, mcp_notices = await resolve_mcp_tools(
        request.app, turn_settings, payload.mcp_server_ids
    )
    for notice in mcp_notices:
        yield ErrorEvent(message=notice, code="mcp_unavailable").to_sse()

    try:
        tools = merge_toolsets(payload.tool_names, mcp_tools)
    except UnknownToolError as exc:
        yield ErrorEvent(message=str(exc), code="unknown_tool").to_sse()
        yield DoneEvent(reason="error").to_sse()
        return

    async for event in run_agent_loop(
        session=session,
        llm_client=llm_client,
        settings=turn_settings,
        user_message=payload.message,
        is_disconnected=request.is_disconnected,
        tools=tools,
        system=system,
    ):
        yield event.to_sse()


@router.post("/session/reset")
async def reset_session(payload: ResetRequest) -> dict[str, bool]:
    existed = session_store.reset(payload.session_id)
    return {"ok": True, "existed": existed}


@router.get("/config")
async def config(settings: Settings = Depends(get_settings)) -> dict[str, object]:
    """What the UI needs to know about the running harness. No secrets."""
    return {
        "provider": settings.llm_provider,
        "model": (
            settings.anthropic_model
            if settings.llm_provider == "anthropic"
            else settings.openai_model
        ),
        "max_iterations": settings.max_agent_iterations,
        "workspace_root": str(settings.workspace_root),
        "mock_mcp": settings.mock_mcp,
    }
