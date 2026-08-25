from app.agent.tools.base import Tool
from app.agent.tools.registry import ALL_TOOLS, TOOLS_BY_NAME


class UnknownToolError(ValueError):
    pass


def resolve_toolset(names: list[str] | None) -> list[Tool]:
    """Turn a node's configured tool names into Tool objects.

    None or [] means the full registry. Order follows ALL_TOOLS rather than the
    caller's list: a stable tool order keeps the request prefix cacheable, which
    is why registry.py keeps ALL_TOOLS ordered in the first place.
    """
    if not names:
        return ALL_TOOLS

    unknown = [name for name in names if name not in TOOLS_BY_NAME]
    if unknown:
        raise UnknownToolError(
            f"Unknown tool(s): {', '.join(sorted(unknown))}. "
            f"Available: {', '.join(sorted(TOOLS_BY_NAME))}"
        )

    wanted = set(names)
    return [tool for tool in ALL_TOOLS if tool.name in wanted]
