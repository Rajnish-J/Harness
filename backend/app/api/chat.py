import logging
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from app.agent.llm.factory import get_llm_client
from app.agent.loop import run_agent_loop
from app.agent.session import ProviderMismatchError, session_store
from app.api.sse import SSE_HEADERS
from app.core.config import Settings, get_settings
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

    try:
        llm_client = get_llm_client(settings)
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

    async for event in run_agent_loop(
        session=session,
        llm_client=llm_client,
        settings=settings,
        user_message=payload.message,
        is_disconnected=request.is_disconnected,
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
    }
