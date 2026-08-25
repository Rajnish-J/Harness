from app.agent.tools.base import Tool
from app.agent.tools.file_tools import FILE_TOOLS

# The whole tool surface for this milestone. Keeping it as one ordered list
# matters: a stable tool order keeps the request prefix cacheable.
ALL_TOOLS: list[Tool] = [*FILE_TOOLS]

TOOLS_BY_NAME: dict[str, Tool] = {tool.name: tool for tool in ALL_TOOLS}


def get_tool(name: str) -> Tool | None:
    return TOOLS_BY_NAME.get(name)
