from app.agent.tools.base import Tool
from app.agent.tools.chat_tools import CHAT_TOOLS
from app.agent.tools.file_tools import FILE_TOOLS
from app.agent.tools.git_tools import GIT_TOOLS
from app.agent.tools.memory_tools import MEMORY_TOOLS
from app.agent.tools.search_tools import SEARCH_TOOLS
from app.agent.tools.shell_tools import SHELL_TOOLS

# The whole tool surface for this milestone. Keeping it as one ordered list
# matters: a stable tool order keeps the request prefix cacheable. FILE_TOOLS
# stays first so existing sessions' cached prompt prefix is unaffected by
# later additions; everything else is strictly appended. MEMORY_TOOLS is the
# newest addition, so it goes last for the same reason -- and CHAT_TOOLS,
# newer still, after it.
ALL_TOOLS: list[Tool] = [
    *FILE_TOOLS,
    *SEARCH_TOOLS,
    *SHELL_TOOLS,
    *GIT_TOOLS,
    *MEMORY_TOOLS,
    *CHAT_TOOLS,
]

TOOLS_BY_NAME: dict[str, Tool] = {tool.name: tool for tool in ALL_TOOLS}


def get_tool(name: str) -> Tool | None:
    return TOOLS_BY_NAME.get(name)
