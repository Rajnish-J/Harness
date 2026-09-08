"""Choosing which tools a turn is even allowed to see, before the turn runs.

The problem this exists for is in the README's own list of known limitations:
the tool list is serialized into every request, so 43 built-ins plus whatever a
couple of MCP servers contribute is a fixed tax on every call of every
iteration. On a small-context model it can crowd out the conversation entirely.

So one cheap call happens first. It is shown the user's message and a COMPACT
catalog -- name, group, one sentence -- and answers with the handful of tools
the task actually needs. That answer narrows what the real turn advertises.

Three properties this module is built around, each of which has a test:

1. It only ever SHRINKS. `keep` is intersected with the pool, so a hallucinated
   name is dropped rather than conjuring a tool the composer's allowlist and
   the /tools disable list had already excluded. The manual controls stay the
   ceiling; this is a floor-raiser underneath them, never an override.

2. It preserves POOL ORDER. The result is built by filtering the pool, never by
   following the order the model happened to list things in. Same reason
   `resolve_toolset` ignores its caller's order and `registry.py` is
   append-only: tool order is the cacheable prompt prefix.

3. It FAILS OPEN. Every failure -- no credential, a timeout, unparseable JSON,
   an empty pick -- returns the whole pool with `ran=False` and a note the UI
   shows. This is the opposite of the fallback in toolsets.merge_toolsets, and
   deliberately so: that one refuses to widen the toolset when an MCP server is
   down, because widening what the model may do is not an acceptable response
   to a network error. Here the failure mode is "this turn costs what it always
   used to", not "the model gained a power someone withheld". Falling closed
   would strand a turn with no tools because a routing call timed out, which is
   a much worse trade than paying for the full list.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from app.agent.tools.base import Tool
from app.agent.tools.meta.request_tools import REQUEST_TOOLS_TOOL

if TYPE_CHECKING:  # pragma: no cover - typing only
    from app.agent.llm.base import LLMClient
    from app.core.config import Settings

logger = logging.getLogger(__name__)

#: Always advertised when the router runs, whatever it picked.
#:
#: A turn that can read a file, list a directory and search text can always make
#: progress -- it can go and FIND what it needs, then ask for the rest through
#: request_tools. Without this floor an over-confident narrow pick is a dead
#: end, because the model has no way to discover what it got wrong.
CORE_TOOL_NAMES: tuple[str, ...] = ("read_file", "list_directory", "search_files")

#: How much of a tool's description reaches the catalog. The whole point is that
#: the catalog is far smaller than the schemas it stands in for, so this is a
#: hard clip rather than a soft preference.
_MAX_DESCRIPTION_CHARS = 180

_SENTENCE_END = re.compile(r"(?<=[.!?])\s")
_JSON_OBJECT = re.compile(r"\{.*\}", re.DOTALL)


@dataclass(frozen=True)
class ToolSelection:
    """The outcome of routing, whether or not a router call actually happened."""

    #: What the turn advertises. Includes the core floor and, when anything was
    #: held back, request_tools.
    tools: list[Tool]
    #: What request_tools is allowed to pull back in. Empty when nothing was
    #: held back, which is also the case whenever `ran` is False.
    reserve: list[Tool] = field(default_factory=list)
    pool_size: int = 0
    #: The router's own one-line justification, shown in the transcript.
    reason: str = ""
    #: False when routing was skipped or failed; `note` then says why.
    ran: bool = False
    note: str | None = None
    model: str | None = None

    @property
    def selected_names(self) -> list[str]:
        return [tool.name for tool in self.tools]

    @property
    def reserve_names(self) -> list[str]:
        return [tool.name for tool in self.reserve]


def first_sentence(text: str, limit: int = _MAX_DESCRIPTION_CHARS) -> str:
    """The lead sentence of a tool description, clipped.

    Tool descriptions here are long on purpose -- several of them spend a
    paragraph on what the tool cannot do, which the model needs when it is
    actually calling them. It does not need any of that to decide whether the
    tool is relevant, and sending it would defeat the point of the catalog.
    """
    collapsed = " ".join(text.split())
    if not collapsed:
        return ""
    head = _SENTENCE_END.split(collapsed, maxsplit=1)[0]
    if len(head) <= limit:
        return head
    return head[: limit - 1].rstrip() + "…"


def catalog_lines(tools: list[Tool]) -> str:
    """The compact tool catalog the router reads instead of the JSON Schemas."""
    return "\n".join(
        f"- {tool.name} [{tool.group}] {first_sentence(tool.description)}"
        for tool in tools
    )


SELECTOR_PROMPT = """You route a coding agent's requests. You are given a user message and a catalog of tools. You reply with the tools that request will actually need.

Reply with ONE JSON object and nothing else:

{"tools": ["name", "name"], "reason": "one short sentence"}

Rules:
- Use only names that appear verbatim in the catalog. Never invent one.
- Prefer too few over too many. The agent can ask for more mid-task, so a missing tool costs it one step; an unnecessary one costs every request for the rest of the turn.
- Reading, searching and directory listing are always available. Do not spend picks on them.
- Include a tool when the request plausibly needs it, not only when it certainly does. Editing usually implies writing; "fix" and "change" usually imply both reading and editing; running or testing implies the execution tools.
- MCP tools are named mcp__{server}__{tool} and are already authenticated. Include them when the request names their domain -- a request about pull requests or issues wants the GitHub server's tools.
- If the message is conversational and needs no tools at all, reply with an empty list.
- `reason` is shown to the user. Say what the task needs, not what you did."""


def parse_selection(text: str | None) -> tuple[list[str], str]:
    """Pull `(names, reason)` out of a router reply.

    Tolerant on purpose: small models fence their JSON, prefix it with "Here is
    the selection:", or wrap it in prose. Anything genuinely unparseable raises
    ValueError, which `select_tools` turns into a fail-open.
    """
    if not text or not text.strip():
        raise ValueError("router returned no text")

    match = _JSON_OBJECT.search(text)
    if match is None:
        raise ValueError("no JSON object in router reply")

    payload: Any = json.loads(match.group(0))
    if not isinstance(payload, dict):
        raise ValueError("router reply was not an object")

    raw = payload.get("tools", [])
    if not isinstance(raw, list):
        raise ValueError("`tools` was not a list")

    names = [item for item in raw if isinstance(item, str) and item]
    reason = payload.get("reason", "")
    return names, reason if isinstance(reason, str) else ""


def _assemble(
    pool: list[Tool],
    keep: set[str],
    *,
    reason: str,
    model: str | None,
) -> ToolSelection:
    """Turn a set of wanted names into a selection, in pool order.

    The two comprehensions below are the whole reason ordering survives routing:
    membership is decided by a set, but SEQUENCE always comes from the pool.
    """
    tools = [tool for tool in pool if tool.name in keep]
    reserve = [tool for tool in pool if tool.name not in keep]

    # Only worth advertising when there is actually something held back. A turn
    # that kept everything has nothing to request, and the extra schema would be
    # pure cost.
    if reserve:
        tools = [*tools, REQUEST_TOOLS_TOOL]

    return ToolSelection(
        tools=tools,
        reserve=reserve,
        pool_size=len(pool),
        reason=reason,
        ran=True,
        model=model,
    )


def _passthrough(pool: list[Tool], note: str | None) -> ToolSelection:
    """The fail-open result: the pool exactly as it arrived."""
    return ToolSelection(tools=list(pool), pool_size=len(pool), ran=False, note=note)


async def select_tools(
    *,
    pool: list[Tool],
    user_message: str,
    client: LLMClient | None,
    settings: Settings,
    model: str | None = None,
    enabled: bool | None = None,
    unavailable_note: str | None = None,
) -> ToolSelection:
    """Narrow `pool` to what `user_message` needs.

    `client` is injected rather than built here so the caller owns credential
    resolution -- and so tests can assert the router was never called at all,
    which is how the threshold behaviour is pinned.

    `enabled` is the per-conversation override: None follows
    `settings.tool_router_enabled`, True forces routing on even below the
    threshold, False skips it entirely.
    """
    if enabled is False:
        return _passthrough(pool, None)

    forced = enabled is True
    if not forced and not settings.tool_router_enabled:
        return _passthrough(pool, None)

    if not pool:
        # Chat mode, or an allowlist that resolved to nothing. Either way there
        # is nothing to narrow and no call worth making.
        return _passthrough(pool, None)

    if not forced and len(pool) <= settings.tool_router_threshold:
        # Already narrow. Routing here would cost a round trip to be told to
        # keep everything, which is a loss on both latency and tokens.
        return _passthrough(pool, None)

    if client is None:
        # The caller could not build a router client. Its own note is more
        # specific than anything this module could say -- "the key for the
        # model you named is missing" beats "no model available" -- so it wins.
        return _passthrough(
            pool, unavailable_note or "No model was available to choose tools with."
        )

    if not user_message.strip():
        return _passthrough(pool, None)

    prompt = (
        f"User message:\n{user_message.strip()}\n\n"
        f"Tool catalog ({len(pool)} tools):\n{catalog_lines(pool)}"
    )

    try:
        turn = await asyncio.wait_for(
            client.send(
                history=[client.user_message(prompt)],
                # No tools: the router is asked for JSON, not for a call. Every
                # client omits an empty list rather than sending one, so this
                # costs nothing and keeps the router prompt genuinely small.
                tools=[],
                system=SELECTOR_PROMPT,
            ),
            timeout=settings.tool_router_timeout,
        )
        names, reason = parse_selection(turn.text)
    except TimeoutError:
        logger.warning("Tool router timed out after %ss", settings.tool_router_timeout)
        return _passthrough(pool, "Choosing tools timed out, so all of them were offered.")
    except Exception as exc:  # noqa: BLE001 - every failure is a fail-open
        logger.exception("Tool router failed")
        return _passthrough(
            pool, f"Could not choose tools ({type(exc).__name__}), so all of them were offered."
        )

    by_name = {tool.name: tool for tool in pool}

    # Intersected with the pool, so a hallucinated name is simply dropped. This
    # is the "never widens" invariant, and it is enforced here rather than
    # trusted to the prompt.
    picked = [name for name in names if name in by_name]
    dropped = len(names) - len(picked)
    if dropped:
        logger.info("Tool router named %d tool(s) that are not in the pool", dropped)

    # The cap applies to the model's picks only. Trimming the core floor away to
    # honour a limit would defeat the floor.
    picked = picked[: settings.tool_router_max_tools]

    keep = {name for name in CORE_TOOL_NAMES if name in by_name}
    keep.update(picked)

    if not keep:
        # Nothing survived -- an empty reply on a pool that has none of the core
        # tools either. Offering a turn zero tools on a guess is worse than
        # offering it everything.
        return _passthrough(pool, "No tools were chosen, so all of them were offered.")

    return _assemble(pool, keep, reason=reason.strip(), model=model)


def restore_selection(
    pool: list[Tool],
    selected_names: list[str] | None,
    reserve_names: list[str] | None,
) -> ToolSelection | None:
    """Rebuild a selection a previous turn made, for the approve path.

    Manual mode re-enters `_prepare_turn` to resume, and re-routing there would
    be both a wasted call and a correctness bug: `session.history` already holds
    tool_use blocks naming the ORIGINAL selection, and a second router call is
    free to answer differently. So the names are replayed instead.

    Returns None when there is nothing stored, which the caller reads as "this
    session predates routing" and handles as a passthrough.
    """
    if selected_names is None:
        return None

    selected = set(selected_names)
    reserved = set(reserve_names or ())

    tools = [tool for tool in pool if tool.name in selected]
    reserve = [tool for tool in pool if tool.name in reserved]

    # Re-derived rather than stored: REQUEST_TOOLS_TOOL is not in the pool (it
    # is not in ALL_TOOLS at all), so filtering the pool above can never bring
    # it back, and a resumed turn must advertise exactly what the first one did.
    if REQUEST_TOOLS_TOOL.name in selected or reserve:
        tools = [*tools, REQUEST_TOOLS_TOOL]

    return ToolSelection(
        tools=tools,
        reserve=reserve,
        pool_size=len(pool),
        ran=True,
        reason="",
    )
