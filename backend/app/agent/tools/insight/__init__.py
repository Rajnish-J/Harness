"""Project insight: stack detection, declared dependencies, file sizes."""

from app.agent.tools.base import Tool
from app.agent.tools.insight.deps_tools import LIST_DEPENDENCIES_TOOL
from app.agent.tools.insight.project_overview import PROJECT_OVERVIEW_TOOL
from app.agent.tools.insight.stats_tools import FILE_STATS_TOOL

INSIGHT_TOOLS: list[Tool] = [
    PROJECT_OVERVIEW_TOOL,
    LIST_DEPENDENCIES_TOOL,
    FILE_STATS_TOOL,
]
