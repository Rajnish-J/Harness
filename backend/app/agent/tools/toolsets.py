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


# The prefix every MCP-discovered tool name carries. Namespacing is what keeps a
# server's `read_file` from shadowing the built-in of the same name.
MCP_PREFIX = "mcp__"


def merge_toolsets(names: list[str] | None, mcp_tools: list[Tool]) -> list[Tool]:
    """Combine the built-in registry with tools discovered from MCP servers.

    Names are partitioned before resolution. An `mcp__*` name that no connected
    server currently offers is dropped rather than raised on: a server being
    unreachable must not turn every chat message into an error. Unknown
    non-MCP names still raise, which is the behaviour test_tool_subset pins.

    Ordering is built-ins in ALL_TOOLS order, then MCP tools sorted by name —
    deterministic for the same reason resolve_toolset ignores caller order.
    """
    mcp_by_name = {tool.name: tool for tool in mcp_tools}

    if not names:
        # No allowlist: everything built in, plus whatever is attached.
        return [*ALL_TOOLS, *sorted(mcp_by_name.values(), key=lambda t: t.name)]

    builtin_names = [name for name in names if not name.startswith(MCP_PREFIX)]
    wanted_mcp = [name for name in names if name.startswith(MCP_PREFIX)]

    builtins = resolve_toolset(builtin_names) if builtin_names else []
    selected_mcp = [mcp_by_name[name] for name in sorted(wanted_mcp) if name in mcp_by_name]

    # An allowlist naming only MCP tools whose servers are all down would leave
    # the model with nothing to call. Fall back to the built-ins so the turn can
    # still make progress; the caller has already emitted an mcp_unavailable
    # notice explaining why.
    if not builtins and not selected_mcp:
        return ALL_TOOLS

    return [*builtins, *selected_mcp]
