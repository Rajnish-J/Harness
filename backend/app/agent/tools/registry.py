from app.agent.tools.base import Tool
from app.agent.tools.codeintel import CODEINTEL_TOOLS
from app.agent.tools.execution.shell_tools import SHELL_TOOLS
from app.agent.tools.files.file_tools import FILE_TOOLS
from app.agent.tools.insight import INSIGHT_TOOLS
from app.agent.tools.memory.memory_tools import MEMORY_TOOLS
from app.agent.tools.project.chat_tools import CHAT_TOOLS
from app.agent.tools.quality import QUALITY_TOOLS
from app.agent.tools.search.search_tools import SEARCH_TOOLS
from app.agent.tools.vcs.git_tools import GIT_TOOLS

# The whole tool surface. Keeping it as one ordered list matters: a stable tool
# order keeps the request prefix cacheable. FILE_TOOLS stays first so existing
# sessions' cached prompt prefix is unaffected by later additions; everything
# else is strictly appended.
#
# Tools live in per-category subpackages (files/, search/, execution/, vcs/,
# memory/, project/, ...), but that is filing, not ordering -- a tool's index
# here is set by this list literal alone, never by which module defined it.
ALL_TOOLS: list[Tool] = [
    *FILE_TOOLS,
    *SEARCH_TOOLS,
    *SHELL_TOOLS,
    *GIT_TOOLS,
    *MEMORY_TOOLS,
    *CHAT_TOOLS,
    # --- Append below this line only. -------------------------------------
    # Inserting above it, or growing one of the lists above, shifts every tool
    # after the insertion point and invalidates the cached prompt prefix for
    # every in-flight session. tests/test_tool_registry_order.py pins this.
    *CODEINTEL_TOOLS,
    *INSIGHT_TOOLS,
    *QUALITY_TOOLS,
]

TOOLS_BY_NAME: dict[str, Tool] = {tool.name: tool for tool in ALL_TOOLS}


def get_tool(name: str) -> Tool | None:
    return TOOLS_BY_NAME.get(name)
