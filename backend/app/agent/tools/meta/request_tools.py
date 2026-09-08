"""The escape hatch out of a too-narrow tool selection.

app/agent/tools/router.py trims the advertised toolset before a turn starts.
That trade is only safe because the model can undo it: if it finds it needs
something that was held back, it asks by name and the loop widens the turn in
place rather than making it start over.

Like PROPOSE_CREATE_PROJECT_TOOL, this is NOT in ALL_TOOLS, and that is load
bearing three times over:

- registry.py is append-only because tool order is the cacheable prompt prefix;
  a tool that is only sometimes present would have to sit somewhere in that
  order and would shift it whenever it appeared.
- /tools renders ALL_TOOLS, and a switch there writes to tool_settings. Letting
  someone globally disable the escape hatch would leave routed turns with no
  way out of a bad pick.
- The disable list is subtracted from the resolved toolset in _prepare_turn, so
  a tool outside the registry can never be accidentally filtered out of a turn
  that needs it.

It is appended by the router instead, and only when something was actually held
back -- there is nothing to request when the pool was kept whole.
"""

from app.agent.tools.base import Tool

REQUEST_TOOLS_TOOL_NAME = "request_tools"


def normalize_names(value: object) -> list[str]:
    """Coerce whatever arrived as `names` into a list of strings.

    Some models send a bare string for a single-element array. Cheaper to
    accept than to spend a round trip teaching them otherwise. Anything else --
    a number, a dict, a nested list -- is dropped rather than stringified, so a
    malformed call reads as "nothing was requested" instead of asking for a
    tool named "42".
    """
    if isinstance(value, str):
        return [value] if value else []
    if isinstance(value, list):
        return [item for item in value if isinstance(item, str) and item]
    return []


def resolve_requested(
    names: list[str], reserve_names: set[str]
) -> tuple[list[str], list[str]]:
    """Split requested names into `(granted, unknown)`.

    Shared by this tool's `run` and by the loop's rebind so the message the
    model reads and the schemas it is actually given can never disagree.
    Order follows the request, since this only ever feeds a message and a
    membership test -- the loop re-derives its own ordering from the reserve.
    """
    granted = [name for name in names if name in reserve_names]
    unknown = [name for name in names if name not in reserve_names]
    return granted, unknown


def request_tools(
    names: list[str] | str,
    tool_reserve_names: set[str] | None = None,
    **_ignored: object,
) -> str:
    """Report what the loop is about to grant.

    The grant itself happens in `_drive` in app/agent/loop.py, which owns
    `tool_schemas` and is the only thing that can widen them mid-turn. This
    body only phrases the outcome -- the loop resolves the same names through
    `resolve_requested`, so the message and the schemas cannot disagree.
    """
    wanted = normalize_names(names)
    if not wanted:
        return (
            "`names` must be a non-empty list of tool name strings, "
            "e.g. {\"names\": [\"git_commit\"]}."
        )

    granted, unknown = resolve_requested(wanted, tool_reserve_names or set())

    parts: list[str] = []
    if granted:
        parts.append(
            f"Added to this turn: {', '.join(granted)}. "
            "They are available now — call them directly."
        )
    if unknown:
        # Not an error result: the model asked a reasonable question and got a
        # straight answer. Flagging it as a failure would push it into a retry
        # loop over a tool that is never coming.
        parts.append(
            f"Not available: {', '.join(unknown)}. "
            "These are switched off for this conversation, so do not ask again — "
            "use what you have, or tell the user what is missing."
        )
    return " ".join(parts)


REQUEST_TOOLS_TOOL = Tool(
    name=REQUEST_TOOLS_TOOL_NAME,
    description=(
        "Ask for a tool that was not advertised for this turn. The tool list "
        "you were given was narrowed to what this task looked like it needed, "
        "and the rest are held back rather than gone. Call this with the names "
        "you want and they become available immediately, in the same turn. Use "
        "it as soon as you notice a gap -- it is cheaper than working around a "
        "missing tool. If you do not know the exact name, ask for the closest "
        "one you can guess; the reply lists what was actually added."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "names": {
                "type": "array",
                "items": {"type": "string"},
                "description": (
                    "Exact tool names, e.g. ['git_commit', 'run_tests']."
                ),
            },
        },
        "required": ["names"],
        "additionalProperties": False,
    },
    run=request_tools,
    group="Harness",
)
