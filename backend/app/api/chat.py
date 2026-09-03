import logging
from collections.abc import AsyncIterator
from dataclasses import dataclass

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from psycopg_pool import AsyncConnectionPool

from app.agent.llm.catalog import PRICING_AS_OF, default_model, models_for
from app.agent.llm.resolver import NoCredentialError, client_for_turn, load_credentials
from app.agent.loop import SYSTEM_PROMPT, run_agent_loop, resume_agent_loop
from app.agent.prompt import compose_system_prompt
from app.agent.session import ProviderMismatchError, Session, session_store
from app.agent.tools.base import Tool
from app.agent.tools.project_tools import PROPOSE_CREATE_PROJECT_TOOL
from app.agent.tools.toolsets import UnknownToolError, merge_toolsets
from app.api.sse import SSE_HEADERS
from app.agent.exec_context import ExecutionContext
from app.core.config import Settings, get_settings
from app.core.secrets import CredentialCryptoError
from app.db import memory_repo, project_chat_repo
from app.projects.execution import resolve_executor
from app.projects.workspaces import InvalidProjectIdError, settings_for_project
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
    #: None means the host, which is what a chat with no project always gets.
    executor: ExecutionContext | None = None
    project_id: str | None = None
    #: Where commands will run, surfaced so the operator is never surprised.
    execution_note: str | None = None
    #: None when DATABASE_URL is unset. Carried on the turn because the loop
    #: needs it at tool-dispatch time, for `remember`; _rehydrate and _persist
    #: read app.state themselves, since they are handed the request anyway.
    pool: AsyncConnectionPool | None = None


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
) -> tuple[Turn, list[tuple[str, str]]]:
    """Resolve a preset into a runnable turn, plus any non-fatal (message, code) notices.

    Shared by both routes so a resumed turn is built exactly like the turn that
    paused — a drift here would mean approving a call from one toolset and
    running it under another.
    """
    # Per-turn overrides. model_copy skips validators, which is what makes this
    # cheap enough to do per request; same trick app/workflow/nodes/agent_node.py
    # uses for a node's iteration cap.
    #
    # The model is NOT one of them any more. It used to be written back into
    # settings so the factory would pick it up, which only worked because there
    # was exactly one provider; now the model decides which provider and which
    # registered key the turn uses, so it is resolved directly instead — see
    # app/agent/llm/resolver.py.
    overrides: dict[str, object] = {}
    if payload.max_iterations:
        overrides["max_agent_iterations"] = payload.max_iterations
    turn_settings = settings.model_copy(update=overrides) if overrides else settings

    # A project-scoped turn works inside that project's checkout. This re-anchors
    # the existing resolve_safe_path guardrail rather than relaxing it: the file
    # tools already read settings.workspace_root, so they need no change.
    executor = None
    execution_note = None
    project_id = getattr(payload, "project_id", None)
    if project_id:
        # resolve_executor is given the UN-rerooted settings on purpose: it
        # derives the bind-mount path with project_workspace() itself, and
        # handing it an already-rerooted root would nest the path twice.
        resolved_exec = await resolve_executor(turn_settings, project_id)
        try:
            turn_settings = settings_for_project(turn_settings, project_id)
        except InvalidProjectIdError as exc:
            raise TurnSetupError(str(exc), "bad_project") from exc
        executor = resolved_exec.executor
        execution_note = resolved_exec.reason

    # Resolved from the requested model rather than from LLM_PROVIDER: the id
    # decides the provider, the provider decides which registered key to spend.
    # (message, code) pairs rather than bare strings: these are emitted as SSE
    # error events, and labelling a provider switch "mcp_unavailable" — which is
    # what a single hardcoded code did — would be a lie to the client.
    setup_notices: list[tuple[str, str]] = []
    pool = getattr(request.app.state, "pool", None)
    try:
        llm_client, _resolved_model = await client_for_turn(
            pool, turn_settings, payload.model
        )
    except NoCredentialError as exc:
        # An operator problem with a specific fix, and the message names it.
        raise TurnSetupError(str(exc), "no_credential") from exc
    except CredentialCryptoError as exc:
        raise TurnSetupError(str(exc), "credential_crypto") from exc
    except Exception as exc:  # noqa: BLE001 - misconfiguration, report to the UI
        logger.exception("Failed to build LLM client")
        raise TurnSetupError(f"LLM provider misconfigured: {exc}", "config") from exc

    try:
        session = session_store.get_or_create(payload.session_id, llm_client.provider)
    except ProviderMismatchError:
        # Not fatal any more. The picker lists every provider that has a key, so
        # switching mid-conversation is an ordinary action; the history cannot
        # follow, so it is dropped and the user is told rather than blocked.
        session = session_store.switch_provider(payload.session_id, llm_client.provider)
        setup_notices.append(
            (
                f"Switched to {llm_client.provider}. Providers store conversation "
                "history in incompatible shapes, so this chat starts fresh.",
                "provider_switched",
            )
        )

    # Chat mode advertises no tools at all (see below), so there is nothing to
    # propose creating a project with there either.
    propose_project_tool = project_id is None and payload.mode != "chat"

    # Same optional-pool discipline as _rehydrate/_persist below: memory is
    # inert, never fatal, when DATABASE_URL is unset. `pool` was already
    # resolved above, for the credential lookup.
    memories: list[memory_repo.MemoryRow] = []
    if pool is not None:
        try:
            memories = await memory_repo.list_active(pool, project_id)
        except Exception:  # noqa: BLE001 - a chat must not die because memory did
            logger.exception("could not load memory for project %s", project_id)

    system = compose_system_prompt(
        base=SYSTEM_PROMPT,
        agent_name=payload.agent_name,
        agent_prompt=payload.system_prompt,
        skills=payload.skills,
        memories=memories,
        no_project_open=propose_project_tool,
        max_chars=turn_settings.max_system_prompt_chars,
    )

    tools: list[Tool] | None
    if payload.mode == "chat":
        # An empty list, not None: None means "the full registry". Nothing is
        # advertised and nothing can be dispatched.
        tools = []
        notices: list[tuple[str, str]] = []
    else:
        # MCP is resolved non-fatally: an unreachable server degrades the turn
        # to the built-in tools rather than failing it.
        mcp_tools, mcp_notices = await resolve_mcp_tools(
            request.app, turn_settings, payload.mcp_server_ids
        )
        notices = [(notice, "mcp_unavailable") for notice in mcp_notices]
        try:
            tools = merge_toolsets(payload.tool_names, mcp_tools)
        except UnknownToolError as exc:
            raise TurnSetupError(str(exc), "unknown_tool") from exc
        if propose_project_tool:
            # Appended locally rather than threaded into merge_toolsets: that
            # module is also reused by workflow nodes, which have no concept
            # of a project-scoped chat. [*tools, ...] also guarantees a fresh
            # list even when merge_toolsets returned the shared ALL_TOOLS.
            tools = [*tools, PROPOSE_CREATE_PROJECT_TOOL]

    return (
        Turn(
            session=session,
            llm_client=llm_client,
            settings=turn_settings,
            system=system,
            tools=tools,
            require_approval=payload.mode == "manual",
            executor=executor,
            project_id=project_id,
            execution_note=execution_note,
            pool=pool,
        ),
        # Setup notices first: "this chat starts fresh" changes how the reply
        # above it should be read, so it belongs before any MCP grumbling.
        setup_notices + notices,
    )


def _setup_failure(exc: TurnSetupError) -> list[AgentEvent]:
    return [
        ErrorEvent(message=exc.message, code=exc.code),
        DoneEvent(reason="error"),
    ]



# --------------------------------------------------------------- persistence


async def _rehydrate(request: Request, turn: Turn) -> None:
    """Reload a chat's history so the agent can continue it.

    Project-scoped or global (`turn.project_id` is None for the chat on `/`) --
    `project_chat_repo` treats both the same way, keyed by session_id, so
    there is nothing project-specific left to gate on here.

    Only fills an EMPTY in-memory session. A session already in memory is
    ahead of the database (the flush happens after a turn, not during it), so
    overwriting it would rewind the conversation by one turn.
    """
    if turn.session.history:
        return
    pool = getattr(request.app.state, "pool", None)
    if pool is None:
        return

    try:
        stored = await project_chat_repo.load_session(pool, turn.session.session_id)
    except Exception:  # noqa: BLE001 - a chat must not die because history did
        logger.exception("could not load history for %s", turn.session.session_id)
        return

    if stored is None:
        return
    if stored.provider != turn.session.provider:
        # Anthropic and OpenAI histories are not interchangeable. Starting
        # fresh beats failing deep inside the SDK on a replay.
        logger.info(
            "dropping %s history for session %s: server now runs %s",
            stored.provider,
            turn.session.session_id,
            turn.session.provider,
        )
        return
    turn.session.history = list(stored.history)


async def _persist(
    request: Request, turn: Turn, entries: list[project_chat_repo.TranscriptEntry]
) -> None:
    """Flush the provider history and the rendered transcript after a turn.

    `turn.project_id` is None for the chat on `/` and a real id for a
    project's -- passed straight through, since both tables now accept NULL.
    """
    pool = getattr(request.app.state, "pool", None)
    if pool is None:
        return

    try:
        await project_chat_repo.save_session(
            pool,
            turn.project_id,
            turn.session.session_id,
            provider=turn.session.provider,
            history=turn.session.history,
        )
        await project_chat_repo.append_messages(
            pool, turn.project_id, turn.session.session_id, entries
        )
    except Exception:  # noqa: BLE001 - the turn already happened
        logger.exception(
            "could not persist chat for session %s", turn.session.session_id
        )


def _entry_for(event: AgentEvent) -> project_chat_repo.TranscriptEntry | None:
    """Turn a streamed event into a transcript row, or None if it is not one."""
    kind = getattr(event, "type", None)
    if kind == "assistant_message":
        return project_chat_repo.TranscriptEntry(role="assistant", content=event.text)
    if kind == "tool_call":
        return project_chat_repo.TranscriptEntry(
            role="tool_call",
            tool_name=event.name,
            tool_call_id=event.id,
            tool_args=event.arguments,
        )
    if kind == "tool_result":
        return project_chat_repo.TranscriptEntry(
            role="tool_result",
            tool_name=event.name,
            tool_call_id=event.id,
            content=event.content,
            is_error=event.is_error,
        )
    if kind == "error":
        return project_chat_repo.TranscriptEntry(role="error", content=event.message)
    # approval_request, project_proposal, and done carry no transcript line of
    # their own.
    return None


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

    for message, code in notices:
        yield ErrorEvent(message=message, code=code).to_sse()

    await _rehydrate(request, turn)

    entries: list[project_chat_repo.TranscriptEntry] = [
        project_chat_repo.TranscriptEntry(role="user", content=payload.message)
    ]

    async for event in run_agent_loop(
        session=turn.session,
        llm_client=turn.llm_client,
        settings=turn.settings,
        user_message=payload.message,
        is_disconnected=request.is_disconnected,
        tools=turn.tools,
        system=turn.system,
        require_approval=turn.require_approval,
        executor=turn.executor,
        pool=turn.pool,
        project_id=turn.project_id,
    ):
        entry = _entry_for(event)
        if entry is not None:
            entries.append(entry)
        yield event.to_sse()

    await _persist(request, turn, entries)


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

    for message, code in notices:
        yield ErrorEvent(message=message, code=code).to_sse()

    decisions = {decision.id: decision.approved for decision in payload.decisions}

    entries: list[project_chat_repo.TranscriptEntry] = []

    async for event in resume_agent_loop(
        session=turn.session,
        llm_client=turn.llm_client,
        settings=turn.settings,
        decisions=decisions,
        is_disconnected=request.is_disconnected,
        tools=turn.tools,
        system=turn.system,
        require_approval=turn.require_approval,
        executor=turn.executor,
        pool=turn.pool,
        project_id=turn.project_id,
    ):
        entry = _entry_for(event)
        if entry is not None:
            entries.append(entry)
        yield event.to_sse()

    await _persist(request, turn, entries)


# ------------------------------------------------------------------- config


@router.post("/session/reset")
async def reset_session(payload: ResetRequest) -> dict[str, bool]:
    existed = session_store.reset(payload.session_id)
    return {"ok": True, "existed": existed}


# ------------------------------------------------------------------ history


@router.get("/chat/sessions")
async def list_chat_sessions(
    request: Request, project_id: str | None = None
) -> dict[str, object]:
    """Recent conversations for one scope: a project, or the global chat when
    `project_id` is omitted. Powers the sidebar's history list.
    """
    pool = getattr(request.app.state, "pool", None)
    if pool is None:
        return {"sessions": []}
    summaries = await project_chat_repo.list_sessions(pool, project_id)
    return {
        "sessions": [
            {
                "session_id": summary.session_id,
                "updated_at": summary.updated_at.isoformat(),
                "message_count": summary.message_count,
                "title": summary.title,
            }
            for summary in summaries
        ]
    }


@router.get("/chat/sessions/{session_id}")
async def get_chat_session(session_id: str, request: Request) -> dict[str, object]:
    """The rendered transcript for one past conversation, so the sidebar's
    history list can reopen it.
    """
    pool = getattr(request.app.state, "pool", None)
    if pool is None:
        return {"messages": []}
    rows = await project_chat_repo.load_transcript_for_session(pool, session_id)
    return {"messages": rows}


@router.get("/models")
async def models(
    request: Request, settings: Settings = Depends(get_settings)
) -> dict[str, object]:
    """The model picker's catalog. Display metadata and health, never a key.

    Every field here is derived from a credential's *metadata* — whether it
    exists, whether it is enabled, and what its last test said. The ciphertext is
    never read on this path and the plaintext never leaves app/agent/llm/resolver.py.
    """
    pool = getattr(request.app.state, "pool", None)
    credentials = await load_credentials(pool, settings)

    return {
        "provider": settings.llm_provider,
        "default": default_model(settings, credentials),
        "pricing_as_of": PRICING_AS_OF,
        "models": [
            model.model_dump(mode="json")
            for model in models_for(settings, credentials)
        ],
    }


@router.get("/config")
async def config(settings: Settings = Depends(get_settings)) -> dict[str, object]:
    """What the UI needs to know about the running harness.

    No secret ever leaves this endpoint. The three that matter are reported as
    booleans under "secrets" — whether each is *configured*, never its value —
    because "workflows are 503-ing" and "DATABASE_URL is unset" are the same
    fact, and the settings page could not state it before.

    Grouped rather than flat: the frontend renders one panel per key, and a
    flat thirty-key blob would leave that mapping implicit. The first five keys
    are unchanged and must stay that way — HarnessStatus reads them too.
    """
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
        "secrets": {
            "llm_api_key": bool(settings.anthropic_api_key or settings.openai_api_key),
            "database_url": bool(settings.database_url),
            "credentials_encryption_key": bool(settings.credentials_encryption_key),
        },
        "limits": {
            "max_file_bytes": settings.max_file_bytes,
            "command_timeout_seconds": settings.command_timeout_seconds,
            "max_command_output_bytes": settings.max_command_output_bytes,
            "max_system_prompt_chars": settings.max_system_prompt_chars,
        },
        # None stays None. The UI renders "not set", which is the honest answer:
        # run_tests refuses rather than guessing a framework.
        "commands": {
            "test": settings.test_command,
            "lint": settings.lint_command,
            "build": settings.build_command,
        },
        "workflows": {
            "max_nodes": settings.max_workflow_nodes,
            "max_supersteps": settings.max_workflow_supersteps,
            "max_node_output_chars": settings.max_node_output_chars,
            "max_interpolated_chars": settings.max_interpolated_chars,
        },
        "mcp": {
            "attach_all_enabled": settings.mcp_attach_all_enabled,
            "connect_timeout": settings.mcp_connect_timeout,
            "list_timeout": settings.mcp_list_timeout,
            "tool_timeout": settings.mcp_tool_timeout,
            "idle_timeout": settings.mcp_idle_timeout,
            "retry_cooldown": settings.mcp_retry_cooldown,
        },
        "containers": {
            "default_image": settings.default_project_image,
            "port": settings.project_container_port,
        },
        "database": {
            "pool_min": settings.db_pool_min,
            "pool_max": settings.db_pool_max,
        },
        "cors_origins": settings.cors_origins,
    }
