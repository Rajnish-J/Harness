from app.agent.tools.base import Tool

PROPOSE_CREATE_PROJECT_TOOL_NAME = "propose_create_project"


def propose_create_project(
    name: str,
    description: str = "",
    **_ignored: object,
) -> str:
    """Signals intent only -- never touches disk or the database.

    `_drive` in app/agent/loop.py intercepts every call to this tool before it
    would normally dispatch and force-parks the turn instead, emitting a
    ProjectProposalEvent for a human to act on. This body only ever runs if a
    human later approves the same call through POST /api/chat/approve -- by
    which point the project was already created client-side (see
    ProjectProposalCard.tsx), so there is nothing left to do here but tell the
    model that.
    """
    return (
        "Proposal recorded. If the user approved it, the project is being "
        "created by the client now -- do not attempt to create it yourself. "
        "If they declined, do not retry; ask what they'd like instead."
    )


PROPOSE_CREATE_PROJECT_TOOL = Tool(
    name=PROPOSE_CREATE_PROJECT_TOOL_NAME,
    description=(
        "Propose creating a new blank project for an idea the user just "
        "described. Only offered when no project is open (the global chat). "
        "Creates nothing itself -- calling it pauses the conversation so a "
        "human can confirm or decline in the UI. Call it once per idea and "
        "wait; do not call it again unless the user describes a different "
        "idea, and do not retry it if they decline."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "name": {
                "type": "string",
                "description": "A short, filesystem-safe project name, e.g. 'expense-tracker'.",
            },
            "description": {
                "type": "string",
                "description": "One or two sentences summarizing what the project will do.",
            },
        },
        "required": ["name"],
        "additionalProperties": False,
    },
    run=propose_create_project,
    group="Project",
)
