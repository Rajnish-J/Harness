"""Code intelligence: structure, definitions, references and import edges."""

from app.agent.tools.base import Tool
from app.agent.tools.codeintel.imports_tools import IMPORTS_TOOLS
from app.agent.tools.codeintel.outline_tools import OUTLINE_TOOLS
from app.agent.tools.codeintel.refs_tools import REFS_TOOLS

CODEINTEL_TOOLS: list[Tool] = [*OUTLINE_TOOLS, *REFS_TOOLS, *IMPORTS_TOOLS]
