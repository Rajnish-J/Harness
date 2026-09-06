"""Offering to file the current conversation under a project that already exists.

The sibling of project_tools.py. That one proposes creating a NEW workspace for
an idea; these two let the model notice that the work already has a home and
offer to move the conversation there instead.

Both are only ever attached in the global chat (see app/api/chat.py) -- inside a
project the conversation already belongs somewhere, and there is nothing to
propose.
"""

from __future__ import annotations

from app.agent.tools.base import Tool, ToolExecutionError
from app.db import project_repo

LIST_PROJECTS_TOOL_NAME = "list_projects"
PROPOSE_ATTACH_PROJECT_TOOL_NAME = "propose_attach_project"

_NO_POOL = (
    "The project list is not available here. Do not retry; carry on without it."
)
_ALREADY_IN_PROJECT = (
    "A project is already open, so this conversation is filed. Do not retry."
)


async def list_projects(limit: int = 20, **context: object) -> str:
    """The projects a conversation could be filed under."""
    pool = context.get("pool")
    if pool is None:
        raise ToolExecutionError(_NO_POOL)
    # Belt-and-braces: chat.py only attaches this tool in the global chat, but a
    # future caller wiring it by name should still get a clear refusal.
    if context.get("project_id"):
        raise ToolExecutionError(_ALREADY_IN_PROJECT)

    capped = max(1, min(int(limit), 50))
    summaries = await project_repo.list_projects(pool, limit=capped)
    if not summaries:
        return (
            "There are no projects yet. Use propose_create_project to suggest "
            "starting one."
        )

    lines = [
        f"- {summary.id}: {summary.name} (updated {summary.updated_at:%Y-%m-%d})"
        for summary in summaries
    ]
    return (
        f"{len(lines)} project(s), most recently updated first:\n"
        + "\n".join(lines)
        + "\n\nTo offer filing this conversation under one, call "
        "propose_attach_project with its id exactly as written above."
    )


def propose_attach_project(
    target_project_id: str,
    reason: str = "",
    **_ignored: object,
) -> str:
    """Signals intent only -- never moves anything.

    `_drive` in app/agent/loop.py intercepts every call to this tool before it
    would dispatch and force-parks the turn instead, emitting an
    AttachProposalEvent for a human to act on. This body only runs if a human
    later approves the same call, by which point the client has already done the
    move (see AttachProposalCard.tsx).

    The parameter is `target_project_id`, NOT `project_id`: _dispatch_tool
    passes the CURRENT project as `project_id` in every tool's context, so a
    parameter of that name would collide and the tool could never be invoked.
    """
    return (
        "Proposal recorded. If the user approved it, the client is filing this "
        "conversation under that project now -- do not attempt to move it "
        "yourself. If they declined, do not retry; carry on here."
    )


LIST_PROJECTS_TOOL = Tool(
    name=LIST_PROJECTS_TOOL_NAME,
    description=(
        "List the projects that already exist, so you can tell whether the work "
        "the user is describing belongs to one of them. Only available in the "
        "global chat. Call this before propose_attach_project -- its ids are "
        "the only valid input to that tool."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "limit": {
                "type": "integer",
                "description": "How many to list. Defaults to 20, capped at 50.",
            }
        },
        "required": [],
        "additionalProperties": False,
    },
    run=list_projects,
    group="Project",
)

PROPOSE_ATTACH_PROJECT_TOOL = Tool(
    name=PROPOSE_ATTACH_PROJECT_TOOL_NAME,
    description=(
        "Offer to file this conversation under a project that already exists, "
        "when the user is continuing work that project covers. Prefer this over "
        "propose_create_project whenever an existing project fits. Call "
        "list_projects first and use an id from it -- never invent one. Moves "
        "nothing itself: calling it pauses the conversation so a human can "
        "confirm or decline in the UI. Call it once per idea and wait; do not "
        "retry it if they decline."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "target_project_id": {
                "type": "string",
                "description": (
                    "A project id returned by list_projects, copied exactly."
                ),
            },
            "reason": {
                "type": "string",
                "description": (
                    "One sentence on why this conversation belongs to that "
                    "project. Shown to the user verbatim."
                ),
            },
        },
        "required": ["target_project_id"],
        "additionalProperties": False,
    },
    run=propose_attach_project,
    group="Project",
)
