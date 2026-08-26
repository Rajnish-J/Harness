"""Wrap MCP-discovered tools as the agent loop's `Tool` dataclass.

No change to the loop is needed: `Tool.run` is a plain callable, and
_dispatch_tool already awaits an awaitable result.
"""

import logging
import re
from typing import Any, Protocol

from app.agent.tools.base import Tool, ToolExecutionError

logger = logging.getLogger(__name__)

#: Anthropic's tool-name rule. Names are sanitized and truncated to fit.
NAME_RE = re.compile(r"[^a-zA-Z0-9_-]")
MAX_NAME_LEN = 128

#: Injected into every tool.run(...) by the agent loop; meaningless to MCP.
LOOP_INJECTED_KWARGS = ("workspace_root", "max_file_bytes")


class Caller(Protocol):
    async def call(self, name: str, args: dict[str, Any]) -> Any: ...


def slugify_server(name: str) -> str:
    return NAME_RE.sub("_", name.strip().lower()).strip("_") or "server"


def namespaced(server_name: str, tool_name: str) -> str:
    """`mcp__{server}__{tool}`.

    Namespacing does three jobs at once: a filesystem server's `read_file`
    cannot shadow the built-in of the same name, two servers can both expose a
    `search`, and the name explains itself in the transcript.
    """
    raw = f"mcp__{slugify_server(server_name)}__{NAME_RE.sub('_', tool_name)}"
    return raw[:MAX_NAME_LEN]


def _render_content(result: Any) -> str:
    """Flatten MCP content blocks into the string the loop expects."""
    blocks = getattr(result, "content", None) or []
    parts: list[str] = []

    for block in blocks:
        text = getattr(block, "text", None)
        if text is not None:
            parts.append(text)
            continue

        data = getattr(block, "data", None)
        if data is not None:
            mime = getattr(block, "mimeType", "application/octet-stream")
            parts.append(f"[{mime}, {len(data)} base64 chars]")
            continue

        resource = getattr(block, "resource", None)
        if resource is not None:
            uri = getattr(resource, "uri", "resource")
            rtext = getattr(resource, "text", None)
            parts.append(f"[{uri}]\n{rtext}" if rtext else f"[{uri}]")
            continue

        parts.append(str(block))

    return "\n".join(parts).strip()


def make_tool(server_name: str, caller: Caller, mcp_tool: Any) -> Tool:
    tool_name = mcp_tool.name
    schema = getattr(mcp_tool, "inputSchema", None) or {
        "type": "object",
        "properties": {},
    }

    # If a server genuinely declares one of these, the loop's injected value
    # would silently win over the model's. Rare, but it should not be silent.
    properties = schema.get("properties") or {}
    for reserved in LOOP_INJECTED_KWARGS:
        if reserved in properties:
            logger.warning(
                "MCP tool %s/%s declares a %r parameter, which the agent loop "
                "injects and this wrapper strips; it will never be passed through",
                server_name,
                tool_name,
                reserved,
            )

    async def run(**kwargs: Any) -> str:
        for reserved in LOOP_INJECTED_KWARGS:
            kwargs.pop(reserved, None)

        result = await caller.call(tool_name, kwargs)

        rendered = _render_content(result)
        if getattr(result, "isError", False):
            # Raised, not returned: _dispatch_tool turns ToolExecutionError into
            # an error result, which is what paints the step red in the UI.
            raise ToolExecutionError(rendered or f"{tool_name} reported an error")
        return rendered or "(no content)"

    return Tool(
        name=namespaced(server_name, tool_name),
        description=f"[{server_name}] {getattr(mcp_tool, 'description', '') or ''}".strip(),
        input_schema=schema,
        run=run,
    )


def dedupe(tools: list[Tool]) -> list[Tool]:
    """Suffix any names that collided after truncation."""
    seen: dict[str, int] = {}
    out: list[Tool] = []

    for tool in tools:
        if tool.name not in seen:
            seen[tool.name] = 1
            out.append(tool)
            continue

        seen[tool.name] += 1
        suffix = f"_{seen[tool.name]}"
        renamed = tool.name[: MAX_NAME_LEN - len(suffix)] + suffix
        logger.warning("MCP tool name collision: %s renamed to %s", tool.name, renamed)
        # Tool is frozen, so a collision produces a new instance.
        out.append(
            Tool(
                name=renamed,
                description=tool.description,
                input_schema=tool.input_schema,
                run=tool.run,
            )
        )

    return out
