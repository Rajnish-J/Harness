import inspect
import logging
from collections.abc import AsyncIterator, Awaitable, Callable

from app.agent.llm.base import LLMClient, ToolCallRequest, ToolResult
from app.agent.session import Session
from app.agent.tools.base import Tool, ToolExecutionError
from app.agent.tools.registry import ALL_TOOLS
from app.core.config import Settings
from app.core.workspace import WorkspaceSecurityError
from app.models.events import (
    AgentEvent,
    AssistantMessageEvent,
    DoneEvent,
    ErrorEvent,
    ToolCallEvent,
    ToolResultEvent,
    truncate_for_event,
)

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are the agent inside Harness, a coding assistant harness.

You have file tools scoped to a sandboxed workspace directory. All paths are \
relative to that workspace root — you cannot read or write anything outside it, \
and attempts to do so will be refused.

Work in small, verifiable steps: inspect before you edit, and read a file back \
after writing it when correctness matters. When a tool returns an error, read \
the message and adjust rather than repeating the same call. When you have \
finished the task, reply with a short summary of what you did."""


async def run_agent_loop(
    *,
    session: Session,
    llm_client: LLMClient,
    settings: Settings,
    user_message: str,
    is_disconnected: Callable[[], Awaitable[bool]] | None = None,
    tools: list[Tool] | None = None,
    system: str | None = None,
) -> AsyncIterator[AgentEvent]:
    """Drive one decide -> act -> observe -> repeat turn to completion.

    Yields events as they happen so the caller can stream them. Every path that
    ends the turn emits a terminal `done` event first, so a client is never
    left waiting. Note `done` is never emitted from a `finally` — yielding
    during generator close would raise, and disconnects close this generator.

    `tools` narrows what this turn may call; None means the full registry, which
    is exactly today's behaviour. It gates *dispatch*, not just the advertised
    schemas, so a hallucinated tool name outside the subset is refused and comes
    back as a normal error result the model can recover from.

    `system` replaces the built-in prompt for this turn; None keeps SYSTEM_PROMPT,
    which is exactly today's behaviour. It is passed fresh on every iteration and
    never stored in `session.history`, so a caller may change it between turns of
    the same session without invalidating the transcript.
    """
    active_tools = ALL_TOOLS if tools is None else tools
    active_system = SYSTEM_PROMPT if system is None else system
    tools_by_name = {tool.name: tool for tool in active_tools}
    tool_schemas = llm_client.tool_schemas(active_tools)
    session.history.append(llm_client.user_message(user_message))

    try:
        for iteration in range(settings.max_agent_iterations):
            if is_disconnected is not None and await is_disconnected():
                # The browser went away — stop before spending another call.
                logger.info(
                    "Client disconnected; abandoning loop for %s", session.session_id
                )
                return

            # ---- decide -------------------------------------------------
            try:
                turn = await llm_client.send(
                    history=session.history,
                    tools=tool_schemas,
                    system=active_system,
                )
            except Exception as exc:  # noqa: BLE001 - classified below
                message, code = _classify_llm_error(exc)
                logger.exception("LLM call failed on iteration %d", iteration)
                yield ErrorEvent(message=message, code=code)
                yield DoneEvent(reason="error")
                return

            if turn.stop_reason == "refusal":
                detail = turn.refusal_detail or "the model declined this request"
                yield ErrorEvent(message=f"Request refused ({detail}).", code="refusal")
                yield DoneEvent(reason="error")
                return

            if turn.stop_reason != "tool_use":
                # end_turn, or max_tokens with nothing left to act on.
                llm_client.append_assistant_turn(session.history, turn)
                if turn.text:
                    yield AssistantMessageEvent(text=turn.text)
                if turn.stop_reason == "max_tokens":
                    yield ErrorEvent(
                        message="Response hit the max_tokens limit and was cut off.",
                        code="max_tokens",
                    )
                yield DoneEvent(reason="end_turn")
                return

            # ---- act ----------------------------------------------------
            # Append the assistant turn first: the tool results that follow are
            # only valid if the tool_use blocks precede them in history.
            llm_client.append_assistant_turn(session.history, turn)
            if turn.text:
                # Models often narrate before calling a tool; surface it.
                yield AssistantMessageEvent(text=turn.text)

            results: list[tuple[ToolCallRequest, ToolResult]] = []
            for call in turn.tool_calls:
                yield ToolCallEvent(
                    id=call.id, name=call.name, arguments=call.arguments
                )
                result = await _dispatch_tool(call, settings, tools_by_name)
                results.append((call, result))
                yield ToolResultEvent(
                    id=call.id,
                    name=call.name,
                    is_error=result.is_error,
                    content=truncate_for_event(result.content),
                )

            # ---- observe ------------------------------------------------
            llm_client.append_tool_results(session.history, results)

        # Fell out of the for-loop: the model kept asking for tools.
        yield ErrorEvent(
            message=(
                f"Stopped after {settings.max_agent_iterations} iterations without "
                "a final answer."
            ),
            code="max_iterations",
        )
        yield DoneEvent(reason="max_iterations")
    except Exception as exc:  # noqa: BLE001 - a harness bug must still close the stream
        logger.exception("Agent loop crashed for session %s", session.session_id)
        yield ErrorEvent(message=f"Harness error: {exc}", code="internal")
        yield DoneEvent(reason="error")


async def _dispatch_tool(
    call: ToolCallRequest,
    settings: Settings,
    tools_by_name: dict[str, Tool],
) -> ToolResult:
    """Run one tool call, turning every failure into a result the model can read."""
    if call.parse_error:
        # Never invoke a tool with arguments we couldn't decode — hand the
        # model its own mistake so it can retry with valid JSON.
        return ToolResult(
            content=f"Could not parse tool arguments: {call.parse_error}",
            is_error=True,
        )

    tool: Tool | None = tools_by_name.get(call.name)
    if tool is None:
        known = ", ".join(sorted(tools_by_name))
        return ToolResult(
            content=f"Unknown tool {call.name!r}. Available tools: {known}.",
            is_error=True,
        )

    try:
        output = tool.run(
            **call.arguments,
            workspace_root=settings.workspace_root,
            max_file_bytes=settings.max_file_bytes,
        )
        if inspect.isawaitable(output):
            output = await output
        return ToolResult(content=str(output))
    except WorkspaceSecurityError as exc:
        # The guardrail firing is expected behaviour, not a crash.
        logger.warning("Sandbox violation via %s: %s", call.name, exc)
        return ToolResult(content=str(exc), is_error=True)
    except ToolExecutionError as exc:
        return ToolResult(content=str(exc), is_error=True)
    except TypeError as exc:
        # Wrong or missing arguments for the tool signature.
        return ToolResult(
            content=f"Invalid arguments for {call.name}: {exc}", is_error=True
        )
    except OSError as exc:
        return ToolResult(content=f"Filesystem error: {exc}", is_error=True)
    except Exception as exc:  # noqa: BLE001 - a tool bug must not kill the loop
        logger.exception("Unexpected failure in tool %s", call.name)
        return ToolResult(content=f"Tool {call.name} failed: {exc}", is_error=True)


def _classify_llm_error(exc: Exception) -> tuple[str, str]:
    """Map a provider exception to a user-facing message and a stable code.

    Both SDKs expose the same exception class names, so this matches on the
    class name rather than importing whichever provider is configured.
    """
    name = type(exc).__name__
    status = getattr(exc, "status_code", None)

    if name == "AuthenticationError":
        return ("LLM API key was rejected. Check your .env.", "auth")
    if name == "PermissionDeniedError":
        return ("LLM API key lacks permission for this model.", "permission")
    if name == "NotFoundError":
        return ("Model not found — check ANTHROPIC_MODEL / OPENAI_MODEL.", "not_found")
    if name == "RateLimitError":
        return ("Rate limited by the LLM provider. Try again shortly.", "rate_limited")
    if name == "BadRequestError":
        return (f"The provider rejected the request: {exc}", "bad_request")
    if name in ("APIConnectionError", "APITimeoutError"):
        return (
            "Could not reach the LLM provider. Check your connection.",
            "connection",
        )
    if isinstance(status, int) and status >= 500:
        return (
            f"LLM provider server error ({status}). Try again later.",
            "server_error",
        )
    return (f"Unexpected error calling the LLM: {exc}", "unknown")
