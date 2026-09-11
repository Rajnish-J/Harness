import inspect
import logging
import re
from uuid import uuid4
from collections.abc import AsyncIterator, Awaitable, Callable

from psycopg_pool import AsyncConnectionPool

from app.agent.llm.base import LLMClient, ToolCallRequest, ToolResult
from app.agent.session import Session
from app.agent.exec_context import ExecutionContext
from app.agent.tools.base import Tool, ToolExecutionError
from app.agent.tools.meta.request_tools import (
    REQUEST_TOOLS_TOOL_NAME,
    normalize_names,
    resolve_requested,
)
from app.agent.tools.project.attach_tools import PROPOSE_ATTACH_PROJECT_TOOL_NAME
from app.agent.tools.project.project_tools import PROPOSE_CREATE_PROJECT_TOOL_NAME
from app.agent.tools.registry import ALL_TOOLS
from app.db import project_repo
from app.core.config import Settings
from app.core.workspace import WorkspaceSecurityError
from app.models.events import (
    AgentEvent,
    ApprovalRequestEvent,
    AssistantMessageEvent,
    AttachProposalEvent,
    DoneEvent,
    ErrorEvent,
    ProjectProposalEvent,
    ToolCallEvent,
    ToolResultEvent,
    truncate_for_event,
)

logger = logging.getLogger(__name__)

def _new_message_uid() -> str:
    """Mint the stable id an assistant message is known by, everywhere.

    The browser numbers live transcript items with a render-time counter and
    a reloaded transcript by `seq`, so neither survives as a key across a
    refresh. This id is generated once here, streamed on the event, and
    stored on the message row -- which is what lets feedback point at a
    message and still find it tomorrow.
    """
    return f"msg_{uuid4().hex[:16]}"


#: The base prompt every turn starts from. compose_system_prompt puts it first
#: and keeps it constant, so it is the shared cacheable prefix for every request
#: in the deployment -- which is also why editing it is a real cost, paid once
#: across every live session, rather than a free tweak.
#:
#: It names tools by role, not by exhaustive list: the schemas already carry the
#: full inventory, and a list here would rot on the next addition.
SYSTEM_PROMPT = """You are the agent inside Harness, a coding harness. You work on real code in a sandboxed workspace, using tools, and you are judged on whether the change actually works.

## The sandbox
All paths are relative to the workspace root. You cannot read or write anything outside it, and attempts to do so are refused. A refusal is a fact about the boundary, not a bug to work around.

## Investigate before you edit
Never edit a file you have not read. Understand what it does now, and what depends on it, before you change it.

Reach for the cheapest tool that answers the question:
- `project_overview` first, in an unfamiliar repository. It reports the stack, the entrypoints, and which of the test, lint, build, typecheck and format commands are actually configured -- so you learn what verification you have before you need it, instead of one refusal at a time.
- `code_outline` to see a file's shape; `read_symbol` to read one function or class. Prefer both over `read_file` on a large file. `file_stats` tells you which files are too big to read whole.
- `find_definition` to locate where a name is declared, `find_references` to find what mentions it, and `find_importers` before you move or rename a module -- it is the fastest way to see what you are about to break.
- `search_files` when you genuinely need a regex over raw text. Reaching for grep first, where a code-intelligence tool would answer better, is the most common way to waste a turn.

Know what these tools can and cannot do. Python is parsed with a real AST, and those answers are exact. TypeScript and JavaScript are matched with regex heuristics: they find conventionally written declarations and miss dynamic ones. `find_references` is a word-boundary text match in every language -- it cannot tell two different things with the same name apart, it matches inside comments and strings, and it misses references reached through an alias or a re-export. Confirm anything you are about to change by reading it.

## Edit deliberately
Pick the narrowest tool for the change:
- `edit_file` for one substring in one file.
- `multi_edit` for several edits to the same file. All-or-nothing: if any edit fails to match, none are applied.
- `apply_patch` for a unified diff across several files. Also all-or-nothing across the whole patch.
- `write_file` only for a genuinely new file or a deliberate full rewrite. Overwriting a file you have not read is how work gets destroyed.

When one of these reports that nothing was applied, believe it: re-applying the part you think succeeded is how a file ends up with the same edit twice.

Make the smallest change that does the job, and match the conventions already in the file -- its naming, its error handling, its import style -- over your own defaults. If you find yourself reformatting code you did not need to touch, stop.

## Verify before you claim
A change you have not run is a guess. After editing, use what the project actually has: `run_typecheck`, `run_tests`, `run_lint`, `run_build`. If a command is not configured the tool says so plainly -- that is a real answer about the project, not a failure, so do not retry it and do not invent a command unless the user asked you to.

When a check fails, read the error and fix the cause. Re-running an unchanged command, or repeating a call that just failed, makes no progress.

## Say what you actually know
When you refer to code, cite it as `path/to/file.py:123`. Report what you observed, and mark what you inferred but did not confirm. If a check did not run, or you could not verify something, say so rather than implying otherwise. A confident summary of work you did not verify is worse than an honest one.

## Working style
Work in small, verifiable steps. When a tool returns an error, read the message and adapt rather than repeating the same call. If a task is ambiguous in a way that changes what you would build, ask before building. When you are done, give a short summary: what changed, where, and how you know it works."""

#: What a denied tool call returns to the model. Phrased as a fact about the
#: user's choice, not a failure, so the model adapts rather than retrying.
DENIED_MESSAGE = (
    "The user denied this tool call. Do not retry it. Continue without it, or "
    "explain what you would need instead."
)


async def run_agent_loop(
    *,
    session: Session,
    llm_client: LLMClient,
    settings: Settings,
    user_message: str,
    is_disconnected: Callable[[], Awaitable[bool]] | None = None,
    tools: list[Tool] | None = None,
    tool_reserve: list[Tool] | None = None,
    system: str | None = None,
    require_approval: bool = False,
    executor: ExecutionContext | None = None,
    pool: AsyncConnectionPool | None = None,
    project_id: str | None = None,
) -> AsyncIterator[AgentEvent]:
    """Drive one decide -> act -> observe -> repeat turn to completion.

    Yields events as they happen so the caller can stream them. Every path that
    ends the turn emits a terminal `done` event first, so a client is never
    left waiting. Note `done` is never emitted from a `finally` — yielding
    during generator close would raise, and disconnects close this generator.

    `tools` narrows what this turn may call; None means the full registry, which
    is exactly today's behaviour, and `[]` means no tools at all (chat mode). It
    gates *dispatch*, not just the advertised schemas, so a hallucinated tool
    name outside the subset is refused and comes back as a normal error result
    the model can recover from.

    `tool_reserve` is what the tool router held back when it narrowed `tools`
    (app/agent/tools/router.py). Nothing in it is advertised or dispatchable
    until the model asks for it by name through `request_tools`, at which point
    the schemas are rebuilt mid-turn. Empty -- the default -- means an unrouted
    turn, where there is nothing held back and the hatch grants nothing.

    `system` replaces the built-in prompt for this turn; None keeps SYSTEM_PROMPT,
    which is exactly today's behaviour. It is passed fresh on every iteration and
    never stored in `session.history`, so a caller may change it between turns of
    the same session without invalidating the transcript.

    `require_approval` parks the turn at the first tool call instead of running
    it: see `_drive`. The turn is finished by `resume_agent_loop`.

    `pool` and `project_id` are only read by the `remember` tool (see
    `_dispatch_tool`) so it can write a memory row scoped to this turn; every
    other tool absorbs them via `**_ignored`. `None` for either disables the
    tool's write silently, the same "degrade, don't fail" contract the rest of
    the app follows when `DATABASE_URL` is unset.
    """
    session.history.append(llm_client.user_message(user_message))

    async for event in _drive(
        session=session,
        llm_client=llm_client,
        settings=settings,
        is_disconnected=is_disconnected,
        tools=tools,
        tool_reserve=tool_reserve,
        system=system,
        require_approval=require_approval,
        executor=executor,
        pool=pool,
        project_id=project_id,
    ):
        yield event


async def resume_agent_loop(
    *,
    session: Session,
    llm_client: LLMClient,
    settings: Settings,
    decisions: dict[str, bool],
    is_disconnected: Callable[[], Awaitable[bool]] | None = None,
    tools: list[Tool] | None = None,
    tool_reserve: list[Tool] | None = None,
    system: str | None = None,
    require_approval: bool = True,
    executor: ExecutionContext | None = None,
    pool: AsyncConnectionPool | None = None,
    project_id: str | None = None,
) -> AsyncIterator[AgentEvent]:
    """Finish a manual-mode turn that parked on `session.pending`.

    No user message is appended: the assistant turn holding these tool_use
    blocks is already in history, and the only thing missing is their results.

    A pending call with no entry in `decisions` counts as denied — silence must
    never authorise a write. A denial becomes an ordinary error result rather
    than a dead end, so the model can apologise, try something narrower, or
    answer without the tool.

    The iteration budget restarts here. Approving a call is a deliberate act, so
    spending another `max_agent_iterations` on it is the behaviour a user
    expects; the cap still bounds any single stream.
    """
    pending = session.pending or []
    # Cleared before anything can fail, so a crashed resume cannot leave a call
    # parked for a second approval.
    session.pending = None

    if not pending:
        yield ErrorEvent(
            message="There is no tool call waiting for approval in this session.",
            code="no_pending_approval",
        )
        yield DoneEvent(reason="error")
        return

    active_tools = ALL_TOOLS if tools is None else tools
    tools_by_name = {tool.name: tool for tool in active_tools}
    # request_tools parks for approval like anything else in manual mode, so the
    # grant has to be applied here as well -- otherwise approving it would widen
    # nothing and the model would be told it had tools it cannot call.
    reserve = list(tool_reserve or ())

    results: list[tuple[ToolCallRequest, ToolResult]] = []
    for call in pending:
        if decisions.get(call.id, False):
            result = await _dispatch_tool(
                call,
                settings,
                tools_by_name,
                executor,
                pool=pool,
                project_id=project_id,
                session_id=session.session_id,
                tool_reserve_names={tool.name for tool in reserve},
            )
            widened, reserve = _apply_tool_request(
                call, result, active_tools, reserve
            )
            if widened is not active_tools:
                active_tools = widened
                tools_by_name = {tool.name: tool for tool in active_tools}
                _remember_widening(session, active_tools, reserve)
        else:
            result = ToolResult(content=DENIED_MESSAGE, is_error=True)
        results.append((call, result))
        yield ToolResultEvent(
            id=call.id,
            name=call.name,
            is_error=result.is_error,
            content=truncate_for_event(result.content),
        )

    async for event in _drive(
        session=session,
        llm_client=llm_client,
        settings=settings,
        is_disconnected=is_disconnected,
        # active_tools, not `tools`: an approved request_tools above may have
        # widened it, and _drive must decide against what was actually granted.
        tools=active_tools,
        tool_reserve=reserve,
        system=system,
        require_approval=require_approval,
        resolved=results,
        executor=executor,
        pool=pool,
        project_id=project_id,
    ):
        yield event


def _remember_widening(
    session: Session, active_tools: list[Tool], reserve: list[Tool]
) -> None:
    """Record a mid-turn grant on the session, so a later approve replays it.

    Manual mode parks on EVERY tool call, so a routed turn can cross the
    approve boundary more than once. `_prepare_turn` rebuilds each resume from
    `session.selected_tool_names`; without this, the second resume would restore
    the ORIGINAL narrow selection and refuse a tool the first resume had already
    granted -- with that tool's own tool_use block sitting in history.

    Only written when the session already carries a selection. Writing one for
    an unrouted turn would pin every later resume to whatever this turn happened
    to hold, turning a full-registry conversation into a narrowed one.
    """
    if session.selected_tool_names is None:
        return
    session.selected_tool_names = [tool.name for tool in active_tools]
    session.reserve_tool_names = [tool.name for tool in reserve]


def _apply_tool_request(
    call: ToolCallRequest,
    result: ToolResult,
    active_tools: list[Tool],
    reserve: list[Tool],
) -> tuple[list[Tool], list[Tool]]:
    """Widen a routed turn's toolset after a successful `request_tools` call.

    The tool router (app/agent/tools/router.py) trims what a turn advertises
    before it starts; this is how the model undoes that trim without having to
    start over. Every other call returns the same two lists unchanged, and the
    caller detects "nothing happened" by identity.

    Granted tools are APPENDED rather than merged back into pool order. Order is
    the cacheable prompt prefix -- the reason registry.py is append-only -- so
    slotting a tool back into its registry position would shift every schema
    after it and invalidate the prefix the turn has already been paying to
    build. Appending leaves every existing index where it was.
    """
    if call.name != REQUEST_TOOLS_TOOL_NAME or result.is_error or not reserve:
        return active_tools, reserve

    granted_names, _unknown = resolve_requested(
        normalize_names(call.arguments.get("names")),
        {tool.name for tool in reserve},
    )
    if not granted_names:
        return active_tools, reserve

    granted = set(granted_names)
    return (
        [*active_tools, *(tool for tool in reserve if tool.name in granted)],
        [tool for tool in reserve if tool.name not in granted],
    )


async def _drive(
    *,
    session: Session,
    llm_client: LLMClient,
    settings: Settings,
    is_disconnected: Callable[[], Awaitable[bool]] | None,
    tools: list[Tool] | None,
    tool_reserve: list[Tool] | None,
    system: str | None,
    require_approval: bool,
    resolved: list[tuple[ToolCallRequest, ToolResult]] | None = None,
    executor: ExecutionContext | None = None,
    pool: AsyncConnectionPool | None = None,
    project_id: str | None = None,
) -> AsyncIterator[AgentEvent]:
    """The decide -> act -> observe iteration itself.

    Shared by the fresh and resumed paths so manual mode cannot drift from
    automatic mode. `resolved` is tool output produced before this generator
    started (a resume), appended to history ahead of the first decision.
    """
    active_tools = ALL_TOOLS if tools is None else tools
    active_system = SYSTEM_PROMPT if system is None else system
    tools_by_name = {tool.name: tool for tool in active_tools}
    tool_schemas = llm_client.tool_schemas(active_tools)
    # Tools the router held back. All three of the bindings above are rebuilt
    # from these when the turn's toolset widens, which happens two ways: the
    # model calls request_tools, or a provider rejects a held-back name outright
    # and we grant it (see _unadvertised_tool_name).
    reserve = list(tool_reserve or ())

    def adopt(widened: list[Tool], new_reserve: list[Tool]) -> None:
        """Take a widened toolset, keeping every derived binding in step.

        The advertised schemas and the dispatch table must never disagree: a
        tool in one and not the other is either a call the provider refuses or
        a name the model can reach but not run. Rebuilding them together, in
        one place, is what makes that impossible.
        """
        nonlocal active_tools, tools_by_name, tool_schemas, reserve
        active_tools = widened
        reserve = new_reserve
        tools_by_name = {tool.name: tool for tool in active_tools}
        tool_schemas = llm_client.tool_schemas(active_tools)
        _remember_widening(session, active_tools, reserve)

    # Accumulated across every LLM call this turn makes — a node can iterate
    # decide->act->observe several times before it's done, so a single call's
    # usage understates the cost of the turn.
    total_usage: dict[str, int] | None = None

    def accumulate(usage: dict[str, int] | None) -> None:
        nonlocal total_usage
        if usage is None:
            return
        if total_usage is None:
            total_usage = {"input_tokens": 0, "output_tokens": 0}
        total_usage["input_tokens"] += usage.get("input_tokens", 0)
        total_usage["output_tokens"] += usage.get("output_tokens", 0)

    try:
        if resolved:
            llm_client.append_tool_results(session.history, resolved)

        for iteration in range(settings.max_agent_iterations):
            if is_disconnected is not None and await is_disconnected():
                # The browser went away — stop before spending another call.
                logger.info(
                    "Client disconnected; abandoning loop for %s", session.session_id
                )
                return

            # ---- decide -------------------------------------------------
            # Two attempts at most: the second exists only for a provider that
            # rejected the whole request over a tool the router held back, and
            # is reached by granting that tool. Bounded three ways -- this
            # range, the reserve shrinking so one name can never be granted
            # twice, and max_agent_iterations around all of it.
            turn = None
            for _attempt in range(2):
                try:
                    turn = await llm_client.send(
                        history=session.history,
                        tools=tool_schemas,
                        system=active_system,
                    )
                    break
                except Exception as exc:  # noqa: BLE001 - classified below
                    refused = _unadvertised_tool_name(exc)
                    wanted = next(
                        (tool for tool in reserve if tool.name == refused), None
                    )
                    if wanted is not None:
                        # The model asked for something real that this turn was
                        # not shown. That is the router being too tight, not a
                        # bad request: grant it and let the model try again.
                        # Appended, never spliced -- order is the cacheable
                        # prefix, same rule as a request_tools grant.
                        logger.info(
                            "Provider refused held-back tool %s; granting it and "
                            "retrying iteration %d",
                            refused,
                            iteration,
                        )
                        adopt(
                            [*active_tools, wanted],
                            [tool for tool in reserve if tool.name != refused],
                        )
                        continue
                    if refused is not None:
                        # Not in the reserve, so there is nothing legitimate to
                        # grant: a hallucinated name, a tool switched off on
                        # /tools, or a candidate from a server the user has not
                        # attached. Conjuring any of those would widen the turn
                        # past what it was allowed to call.
                        logger.warning(
                            "Provider refused tool %s, which this turn never "
                            "held back; not granting it",
                            refused,
                        )
                    message, code = _classify_llm_error(exc)
                    logger.exception("LLM call failed on iteration %d", iteration)
                    yield ErrorEvent(message=message, code=code)
                    yield DoneEvent(reason="error", usage=total_usage)
                    return

            if turn is None:
                # Both attempts were refused over a held-back tool. The first
                # grant did not satisfy the model and a second would be an
                # unbounded widen, so stop rather than keep buying calls.
                logger.warning(
                    "Provider refused a tool call twice on iteration %d", iteration
                )
                yield ErrorEvent(
                    message=(
                        "The provider rejected the request: the model kept "
                        "calling tools that were not offered to it."
                    ),
                    code="bad_request",
                )
                yield DoneEvent(reason="error", usage=total_usage)
                return

            accumulate(turn.usage)

            if turn.stop_reason == "refusal":
                detail = turn.refusal_detail or "the model declined this request"
                yield ErrorEvent(message=f"Request refused ({detail}).", code="refusal")
                yield DoneEvent(reason="error", usage=total_usage)
                return

            if turn.stop_reason != "tool_use":
                # end_turn, or max_tokens with nothing left to act on.
                llm_client.append_assistant_turn(session.history, turn)
                if turn.text:
                    yield AssistantMessageEvent(
                        text=turn.text, message_uid=_new_message_uid()
                    )
                if turn.stop_reason == "max_tokens":
                    yield ErrorEvent(
                        message="Response hit the max_tokens limit and was cut off.",
                        code="max_tokens",
                    )
                yield DoneEvent(reason="end_turn", usage=total_usage)
                return

            # ---- act ----------------------------------------------------
            # Append the assistant turn first: the tool results that follow are
            # only valid if the tool_use blocks precede them in history.
            llm_client.append_assistant_turn(session.history, turn)
            if turn.text:
                # Models often narrate before calling a tool; surface it.
                yield AssistantMessageEvent(
                    text=turn.text, message_uid=_new_message_uid()
                )

            proposal_ids = {
                call.id
                for call in turn.tool_calls
                if call.name == PROPOSE_CREATE_PROJECT_TOOL_NAME
            }
            attach_ids = {
                call.id
                for call in turn.tool_calls
                if call.name == PROPOSE_ATTACH_PROJECT_TOOL_NAME
            }

            if require_approval or proposal_ids or attach_ids:
                # Park the turn. History already ends with the assistant turn,
                # so resuming only has to append results — which is why nothing
                # else about the turn needs storing. A project proposal parks
                # even in agent mode: creating a project is a one-way door, so
                # this pause is never optional the way manual-mode approval is.
                # An attach proposal parks for a softer reason -- the move is
                # reversible -- but a conversation must never relocate itself
                # without the human who is having it saying so.
                session.pending = list(turn.tool_calls)
                for call in turn.tool_calls:
                    if call.id in proposal_ids:
                        yield ProjectProposalEvent(
                            id=call.id,
                            name=str(call.arguments.get("name", "")),
                            description=str(call.arguments.get("description", "")),
                            template=str(call.arguments.get("template", "")),
                        )
                    elif call.id in attach_ids:
                        resolved = await _resolve_attach_target(pool, call)
                        if resolved is None:
                            yield ApprovalRequestEvent(
                                id=call.id,
                                name=call.name,
                                arguments=call.arguments,
                            )
                        else:
                            target_id, target_name = resolved
                            yield AttachProposalEvent(
                                id=call.id,
                                project_id=target_id,
                                project_name=target_name,
                                reason=str(call.arguments.get("reason", "")),
                            )
                    else:
                        yield ApprovalRequestEvent(
                            id=call.id, name=call.name, arguments=call.arguments
                        )
                yield DoneEvent(reason="awaiting_approval", usage=total_usage)
                return

            results: list[tuple[ToolCallRequest, ToolResult]] = []
            for call in turn.tool_calls:
                yield ToolCallEvent(
                    id=call.id, name=call.name, arguments=call.arguments
                )
                result = await _dispatch_tool(
                    call,
                    settings,
                    tools_by_name,
                    executor,
                    pool=pool,
                    project_id=project_id,
                    session_id=session.session_id,
                    tool_reserve_names={tool.name for tool in reserve},
                )

                # A granted request_tools call is the one thing that changes the
                # turn's toolset mid-flight, so the schemas the next decision
                # sees are rebuilt here rather than once at the top.
                widened, new_reserve = _apply_tool_request(
                    call, result, active_tools, reserve
                )
                if widened is not active_tools:
                    adopt(widened, new_reserve)
                else:
                    reserve = new_reserve

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
        yield DoneEvent(reason="max_iterations", usage=total_usage)
    except Exception as exc:  # noqa: BLE001 - a harness bug must still close the stream
        logger.exception("Agent loop crashed for session %s", session.session_id)
        yield ErrorEvent(message=f"Harness error: {exc}", code="internal")
        yield DoneEvent(reason="error", usage=total_usage)


async def _resolve_attach_target(
    pool: AsyncConnectionPool | None, call: ToolCallRequest
) -> tuple[str, str] | None:
    """(project_id, project_name) for an attach proposal, or None if unusable.

    The model supplies the id, so it may be invented, stale, or archived. A card
    naming a project that does not exist is worse than no card, so an id that
    does not resolve degrades to an ordinary approval request instead -- the
    human can still deny it, and the denial tells the model to list first.
    """
    if pool is None:
        return None

    target = str(call.arguments.get("target_project_id", "")).strip()
    if not target:
        return None

    try:
        project = await project_repo.get_project(pool, target)
    except Exception:  # noqa: BLE001 - a malformed id must not kill the turn
        logger.exception("could not resolve attach target %s", target)
        return None

    return (str(project.id), project.name) if project else None


async def _dispatch_tool(
    call: ToolCallRequest,
    settings: Settings,
    tools_by_name: dict[str, Tool],
    executor: ExecutionContext | None = None,
    *,
    pool: AsyncConnectionPool | None = None,
    project_id: str | None = None,
    session_id: str | None = None,
    tool_reserve_names: set[str] | None = None,
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
            command_timeout_seconds=settings.command_timeout_seconds,
            max_command_output_bytes=settings.max_command_output_bytes,
            test_command=settings.test_command,
            lint_command=settings.lint_command,
            build_command=settings.build_command,
            # Only the shell tools read this; every other tool absorbs it via
            # **_ignored. None means the host, which is the pre-container
            # behaviour and stays the default for a chat with no project.
            executor=executor,
            # Only the `remember` tool reads these three; every other tool
            # absorbs them via **_ignored, same as executor above.
            pool=pool,
            project_id=project_id,
            session_id=session_id,
            # Read by the quality tools (run_typecheck/run_format) and reported
            # by project_overview, which tells the model which checks exist
            # before it spends a turn discovering one is unconfigured.
            typecheck_command=settings.typecheck_command,
            format_command=settings.format_command,
            # Read only by the web tools. Passed as settings rather than read
            # from get_settings() inside them so a per-turn model_copy (and a
            # test's fixture) actually reaches them.
            web_tools_enabled=settings.web_tools_enabled,
            web_timeout_seconds=settings.web_timeout_seconds,
            web_max_response_bytes=settings.web_max_response_bytes,
            web_allowed_domains=settings.web_allowed_domains,
            web_search_provider=settings.web_search_provider,
            web_search_api_key=settings.web_search_api_key,
            # Read only by request_tools, so its message can name exactly what
            # the loop is about to grant; every other tool absorbs it via
            # **_ignored, same as executor and pool above.
            tool_reserve_names=tool_reserve_names,
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


#: A provider refusing a tool call because the name was not in the request.
#:
#: Anchored on `request.tools`, which is the discriminator: no other provider
#: phrases a rejection that way, so matching the string is both narrower and
#: more durable than branching on which client was configured -- a Groq
#: compatible base_url behind some other SDK is still handled.
_UNADVERTISED_TOOL_RE = re.compile(
    r"call(?:ed)?\s+tool\s+['\"`]([A-Za-z0-9_\-]+)['\"`][^.]*?not\s+in\s+request\.tools",
    re.IGNORECASE,
)


def _unadvertised_tool_name(exc: Exception) -> str | None:
    """The tool a provider refused to call, or None if that is not this error.

    Providers disagree about what calling an unadvertised tool means. Anthropic
    treats it as one bad call: the turn survives, the model reads the error and
    asks for the tool through request_tools. Groq rejects the entire request
    with a 400, so that recovery never gets to happen and a narrowed turn dies
    on its first wrong guess. Naming the tool here is what lets the caller grant
    it and try again, making the two providers behave the same way.
    """
    if type(exc).__name__ != "BadRequestError":
        return None
    match = _UNADVERTISED_TOOL_RE.search(str(exc))
    return match.group(1) if match else None


def _classify_llm_error(exc: Exception) -> tuple[str, str]:
    """Map a provider exception to a user-facing message and a stable code.

    Both SDKs expose the same exception class names, so this matches on the
    class name rather than importing whichever provider is configured.
    """
    name = type(exc).__name__
    status = getattr(exc, "status_code", None)

    # These messages name the fix, and the fix moved: provider keys are
    # registered on the Credentials page now, with .env only as a fallback.
    if name == "AuthenticationError":
        return (
            "The provider rejected this API key. Re-test or replace it under "
            "Credentials → Models.",
            "auth",
        )
    if name == "PermissionDeniedError":
        return (
            "This API key lacks permission for this model. Check the key's "
            "scopes under Credentials → Models.",
            "permission",
        )
    if name == "NotFoundError":
        return (
            "The provider does not have this model. Pick another in the model "
            "picker, or correct the id on the credential.",
            "not_found",
        )
    if name == "RateLimitError":
        return (
            "Rate limited by the provider, or out of quota. Try again shortly.",
            "rate_limited",
        )
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
