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

import re

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


#: How many alternatives to offer for a name that missed. Enough to cover a
#: server's obvious neighbours, short enough that the reply stays readable.
_MAX_SUGGESTIONS = 8


def suggest_for(name: str, reserve_names: set[str]) -> list[str]:
    """Reserve names worth offering in place of one that did not match.

    A miss is usually a near miss. MCP tools are namespaced
    `mcp__<server>__<tool>`, so a model that knows which server it wants and
    guesses the leaf wrong -- `mcp__github__list_user_repos` for
    `mcp__github__search_repositories` -- is one correction away from the
    right call. Same-server names come first for exactly that case; a shared
    word catches the rest.

    Ordered, not a set: this is read by a model, and a stable order keeps the
    reply reproducible.
    """
    if not reserve_names:
        return []

    lowered = name.lower()
    prefix = ""
    if lowered.startswith("mcp__"):
        # `mcp__<server>__` -- everything up to and including the second pair
        # of underscores, when there is one.
        parts = name.split("__")
        if len(parts) >= 3:
            prefix = f"{parts[0]}__{parts[1]}__".lower()

    same_server = sorted(
        candidate
        for candidate in reserve_names
        if prefix and candidate.lower().startswith(prefix)
    )

    # A shared word, for non-namespaced tools and for a wrong server guess.
    words = {word for word in re.split(r"[^a-z0-9]+", lowered) if len(word) > 3}
    related = sorted(
        candidate
        for candidate in reserve_names
        if candidate not in same_server
        and any(word in candidate.lower() for word in words)
    )

    return [*same_server, *related][:_MAX_SUGGESTIONS]


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
        #
        # But "no such name" and "that capability is off" are DIFFERENT
        # answers, and conflating them is how a typo became a confident
        # report that a working server was unavailable. A name with near
        # matches is a misspelling: name them and let the model correct
        # itself. Only a name with nothing close is genuinely absent.
        reserve = tool_reserve_names or set()
        for name in unknown:
            suggestions = suggest_for(name, reserve)
            if suggestions:
                parts.append(
                    f"There is no tool named {name}. Did you mean: "
                    f"{', '.join(suggestions)}? Call request_tools again "
                    "with the exact name."
                )
            else:
                parts.append(
                    f"Not available: {name}. Nothing like it is held back "
                    "for this conversation, so do not ask again — use what "
                    "you have, or tell the user what is missing."
                )
    return " ".join(parts)


def request_tools_tool(reserve_names: list[str] | None = None) -> Tool:
    """Build the escape hatch for one turn, naming what it can actually reach.

    Built per turn rather than shared, because the useful part is the `enum`:
    the held-back names go into the schema, so the model picks from a list
    instead of guessing. That matters more than it sounds. This tool used to
    advise "if you do not know the exact name, ask for the closest one you can
    guess" while sending no names at all -- and a model looking for GitHub
    repositories duly invented `mcp__github__list_user_repos`, missed, and told
    the user the capability did not exist. The tool it wanted was in the
    reserve the whole time under another name.

    An enum also does the strongest thing available: a constrained decoder
    cannot emit a name that is not in it, so the failure becomes impossible
    rather than merely discouraged.

    `reserve_names` empty (or omitted) yields the plain schema. Callers that
    only need the NAME should use REQUEST_TOOLS_TOOL_NAME rather than building
    a throwaway tool.
    """
    names_schema: dict[str, object] = {
        "type": "array",
        "items": {"type": "string"},
        "description": "Exact tool names, e.g. ['git_commit', 'run_tests'].",
    }
    if reserve_names:
        # Sorted so the schema -- and therefore the prompt prefix -- is stable
        # across turns that hold back the same set.
        names_schema["items"] = {"type": "string", "enum": sorted(reserve_names)}

    return Tool(
        name=REQUEST_TOOLS_TOOL_NAME,
        description=(
            "Ask for a tool that was not advertised for this turn. The tool "
            "list you were given was narrowed to what this task looked like it "
            "needed, and the rest are held back rather than gone. Call this "
            "with the names you want and they become available immediately, in "
            "the same turn. Use it as soon as you notice a gap -- it is cheaper "
            "than working around a missing tool. Every name you can ask for is "
            "listed in this tool's `names` schema; use one of those exactly, "
            "and do not invent a name that is not there."
        ),
        input_schema={
            "type": "object",
            "properties": {"names": names_schema},
            "required": ["names"],
            "additionalProperties": False,
        },
        run=request_tools,
        group="Harness",
    )


#: The zero-reserve form. Kept for callers that want the tool without a turn's
#: context -- tests, and anything reading `.name`. The router builds its own
#: per turn so the enum is populated.
REQUEST_TOOLS_TOOL = request_tools_tool()
