from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class Tool:
    """A tool the agent can call.

    `input_schema` is plain JSON Schema; each LLM client renders it into its own
    dialect (Anthropic's `input_schema`, OpenAI's `function.parameters`), so
    tools never need to know which provider is running.
    """

    name: str
    description: str
    input_schema: dict[str, Any]
    run: Callable[..., str]
    #: Presentation only. The composer's tool panel renders one section per
    #: group; the model never sees it, and ALL_TOOLS keeps its own order so the
    #: request prefix stays cacheable.
    group: str = "General"


class ToolExecutionError(Exception):
    """A tool failed in a way the model should see and can recover from."""


def workspace_tool_context(workspace_root: Path, max_file_bytes: int) -> dict[str, Any]:
    return {"workspace_root": workspace_root, "max_file_bytes": max_file_bytes}
