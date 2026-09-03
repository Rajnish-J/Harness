"""The `remember` tool: how the agent writes to cross-session memory.

Unlike `propose_create_project`, this tool runs to completion immediately --
no human-approval pause -- because writing a memory is additive and fully
reversible (edit or archive it from the /memory admin page). It executes
synchronously against Postgres from inside the tool-dispatch path, so it is
async, unlike every other tool in this package; `_dispatch_tool` in
app/agent/loop.py already awaits a tool's output when it is awaitable.
"""

from __future__ import annotations

import logging

from app.agent.tools.base import Tool, ToolExecutionError
from app.db import memory_repo

logger = logging.getLogger(__name__)

REMEMBER_TOOL_NAME = "remember"


async def remember(
    title: str,
    content: str,
    kind: str = "fact",
    slug: str = "",
    scope: str = "project",
    **context: object,
) -> str:
    """Save a durable memory. See app/agent/tools/memory_tools.py for the
    context on why this is the one tool that writes to Postgres directly."""
    pool = context.get("pool")
    if pool is None:
        # Either DATABASE_URL is unset, or this turn is running somewhere that
        # does not thread a pool through -- a workflow node, today. Both are
        # "not here", not "you called it wrong", so say that rather than
        # blaming configuration the model cannot see.
        raise ToolExecutionError(
            "Memory is not available in this context, so nothing was saved. "
            "Do not retry; carry on without it."
        )

    if kind not in memory_repo.VALID_KINDS:
        raise ToolExecutionError(
            f"Unknown kind {kind!r}. Use one of: {', '.join(memory_repo.VALID_KINDS)}."
        )
    if scope not in ("project", "global"):
        raise ToolExecutionError("scope must be 'project' or 'global'.")

    project_id = context.get("project_id") if scope == "project" else None
    session_id = context.get("session_id")
    resolved_slug = slug.strip() or memory_repo.slugify(title)

    row = await memory_repo.upsert(
        pool,
        project_id=project_id,
        kind=kind,
        slug=resolved_slug,
        title=title,
        content=content,
        source="agent",
        session_id=session_id,
    )

    where = "globally" if row.project_id is None else "for this project"
    return f"Saved memory {row.slug!r} ({row.kind}), applies {where}."


REMEMBER_TOOL = Tool(
    name=REMEMBER_TOOL_NAME,
    description=(
        "Save a fact, preference, or piece of feedback so it survives this "
        "conversation and reaches OTHER chat sessions too -- not just this "
        "one. Use it when the user states a durable preference or "
        "correction ('always run tests before committing', 'I prefer tabs "
        "over spaces'), or when you learn something about this project "
        "worth remembering for next time. Do not use it for facts already "
        "obvious from the code, or for anything only relevant to finishing "
        "the current task. kind is one of: preference (how the user wants "
        "to work), feedback (a correction or confirmed approach, with the "
        "reason), fact (something true about this project or its domain), "
        "reference (a pointer to where information lives, e.g. an issue "
        "tracker). scope is 'project' (default -- applies only to the "
        "current project; becomes global automatically if no project is "
        "open, since the top-level chat has no narrower scope to attach to) "
        "or 'global' (applies to every project and chat -- use for things "
        "true regardless of which project is open, e.g. a preference about "
        "how the user likes to work)."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "title": {
                "type": "string",
                "description": "A short, human-readable label for this memory.",
            },
            "content": {
                "type": "string",
                "description": (
                    "The memory itself, in a sentence or two: the fact or rule, "
                    "plus why it matters and when it applies. Markdown is fine."
                ),
            },
            "kind": {
                "type": "string",
                "enum": list(memory_repo.VALID_KINDS),
                "description": "preference, feedback, fact, or reference. Defaults to fact.",
            },
            "slug": {
                "type": "string",
                "description": (
                    "Optional stable id for this memory, kebab-case. Re-using an "
                    "existing slug edits that memory instead of creating a new "
                    "one. Left blank, one is derived from the title."
                ),
            },
            "scope": {
                "type": "string",
                "enum": ["project", "global"],
                "description": (
                    "'project' (default) attaches to the current project; "
                    "becomes global automatically if no project is open. "
                    "'global' applies everywhere -- only use it for something "
                    "that is true regardless of which project is open."
                ),
            },
        },
        "required": ["title", "content"],
        "additionalProperties": False,
    },
    run=remember,
    group="Memory",
)

MEMORY_TOOLS: list[Tool] = [REMEMBER_TOOL]
