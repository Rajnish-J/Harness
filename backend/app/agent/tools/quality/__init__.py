"""Verification and multi-change editing: typecheck, format, patch, multi-edit."""

from app.agent.tools.base import Tool
from app.agent.tools.quality.check_tools import CHECK_TOOLS
from app.agent.tools.quality.patch_tools import PATCH_TOOLS

QUALITY_TOOLS: list[Tool] = [*CHECK_TOOLS, *PATCH_TOOLS]
