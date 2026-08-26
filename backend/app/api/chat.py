import logging
from collections.abc import AsyncIterator
from dataclasses import dataclass

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from app.agent.llm.catalog import PRICING_AS_OF, configured_model, models_for
from app.agent.llm.factory import get_llm_client
from app.agent.loop import SYSTEM_PROMPT, run_agent_loop, resume_agent_loop
from app.agent.prompt import compose_system_prompt
from app.agent.session import ProviderMismatchError, Session, session_store
from app.agent.tools.base import Tool
from app.agent.tools.toolsets import UnknownToolError, merge_toolsets
from app.api.sse import SSE_HEADERS
from app.core.config import Settings, get_settings
from app.mcp import resolve_mcp_tools
from app.models.chat import ApprovalRequest, ChatRequest, ResetRequest, TurnPreset
from app.models.events import AgentEvent, DoneEvent, ErrorEvent, sse_comment

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
        _chat_stream(request, payload, settings),
        media_type="text/event-stream",
        headers=SSE_HEADERS,
    )


@router.post("/chat/approve")
async def approve(
    request: Request,
    payload: ApprovalRequest,
    settings: Settings = Depends(get_settings),
) -> StreamingResponse:
    """Finish a manual-mode turn that is parked awaiting approval.

    A second POST rather than a duplex connection: streaming here is still
    one-directional, and the preset in the body rebuilds the same turn context
    the paused request had, so nothing about the turn has to be parked with it.
    """
    return StreamingResponse(
        _approve_stream(request, payload, settings),
        media_type="text/event-stream",
        headers=SSE_HEADERS,
    )


# --------------------------------------------------------------- turn setup


@dataclass
class Turn:
    """Everything a turn needs, resolved from a preset."""

    session: Session
    llm_client: object
    settings: Settings
    system: str
    tools: list[Tool] | None
    require_approval: bool


class TurnSetupError(Exception):
    """Setup failed in a way the client should see as a normal SSE error."""

    def __init__(self, message: str, code: str) -> None:
        super().__init__(message)
        self.message = message
        self.code = code


async def _prepare_turn(
    request: Request,
    payload: TurnPreset,
    settings: Settings,
) -> tuple[Turn, list[str]]:
    """Resolve a preset into a runnable turn, plus any non-fatal notices.

    Shared by both routes so a resumed turn is built exactly like the turn that
    paused — a drift here would mean approving a call from one toolset and
    running it under another.
    """
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
        raise TurnSetupError(f"LLM provider misconfigured: {exc}", "config") from exc

    try:
        session = session_store.get_or_create(payload.session_id, llm_client.provider)
    except ProviderMismatchError as exc:
        raise TurnSetupError(str(exc), "provider_mismatch") from exc

    system = compose_system_prompt(
        base=SYSTEM_PROMPT,
        agent_name=payload.agent_name,
        agent_prompt=payload.system_prompt,
        skills=payload.skills,
        max_chars=turn_settings.max_system_prompt_chars,
    )

    tools: list[Tool] | None
    if payload.mode == "chat":
        # An empty list, not None: None means "the full registry". Nothing is
        # advertised and nothing can be dispatched.
        tools = []
        notices: list[str] = []
    else:
        # MCP is resolved non-fatally: an unreachable server degrades the turn
        # to the built-in tools rather than failing it.
        mcp_tools, notices = await resolve_mcp_tools(
            request.app, turn_settings, payload.mcp_server_ids
        )
        try:
            tools = merge_toolsets(payload.tool_names, mcp_tools)
        except UnknownToolError as exc:
            raise TurnSetupError(str(exc), "unknown_tool") from exc

    return (
        Turn(
            session=session,
            llm_client=llm_client,
            settings=turn_settings,
            system=system,
            tools=tools,
            require_approval=payload.mode == "manual",
        ),
        notices,
    )


def _setup_failure(exc: TurnSetupError) -> list[AgentEvent]:
    return [
        ErrorEvent(message=exc.message, code=exc.code),
        DoneEvent(reason="error"),
    ]


# ------------------------------------------------------------------ streams


async def _chat_stream(
    request: Request,
    payload: ChatRequest,
    settings: Settings,
) -> AsyncIterator[str]:
    # Flush headers immediately so the client's reader starts before the first
    # (potentially slow) LLM call returns.
    yield sse_comment("stream open")

    try:
        turn, notices = await _prepare_turn(request, payload, settings)
    except TurnSetupError as exc:
        for event in _setup_failure(exc):
            yield event.to_sse()
        return

    for notice in notices:
        yield ErrorEvent(message=notice, code="mcp_unavailable").to_sse()

    async for event in run_agent_loop(
        session=turn.session,
        llm_client=turn.llm_client,
        settings=turn.settings,
        user_message=payload.message,
        is_disconnected=request.is_disconnected,
        tools=turn.tools,
        system=turn.system,
        require_approval=turn.require_approval,
    ):
        yield event.to_sse()


async def _approve_stream(
    request: Request,
    payload: ApprovalRequest,
    settings: Settings,
) -> AsyncIterator[str]:
    yield sse_comment("stream open")

    try:
        turn, notices = await _prepare_turn(request, payload, settings)
    except TurnSetupError as exc:
        for event in _setup_failure(exc):
            yield event.to_sse()
        return

    for notice in notices:
        yield ErrorEvent(message=notice, code="mcp_unavailable").to_sse()

    decisions = {decision.id: decision.approved for decision in payload.decisions}

    async for event in resume_agent_loop(
        session=turn.session,
        llm_client=turn.llm_client,
        settings=turn.settings,
        decisions=decisions,
        is_disconnected=request.is_disconnected,
        tools=turn.tools,
        system=turn.system,
        require_approval=turn.require_approval,
    ):
        yield event.to_sse()


# ------------------------------------------------------------------- config


@router.post("/session/reset")
async def reset_session(payload: ResetRequest) -> dict[str, bool]:
    existed = session_store.reset(payload.session_id)
    return {"ok": True, "existed": existed}


@router.get("/models")
async def models(settings: Settings = Depends(get_settings)) -> dict[str, object]:
    """The model picker's catalog. Display metadata only, no secrets."""
    return {
        "provider": settings.llm_provider,
        "default": configured_model(settings),
        "pricing_as_of": PRICING_AS_OF,
        "models": [model.model_dump() for model in models_for(settings)],
    }


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
