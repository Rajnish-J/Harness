from app.agent.tools.base import Tool
from app.projects.templates import TEMPLATES

PROPOSE_CREATE_PROJECT_TOOL_NAME = "propose_create_project"


def propose_create_project(
    name: str,
    description: str = "",
    template: str = "",
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
        "Propose creating a new project workspace for an idea the user just "
        "described. Only offered when no project is open (the global chat). A "
        "project is a persistent workspace: it gets its own git repository and "
        "its own editor container, it can be connected to GitHub afterwards, "
        "and the user pushes their work when it is done. Creates nothing "
        "itself -- calling it pauses the conversation so a human can confirm, "
        "change the scaffold, or decline in the UI. Call it once per idea and "
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
            "template": {
                # An enum rather than free text: the id reaches a registry
                # lookup, and a hallucinated one would be a 400 the user has to
                # decipher. The human can still change it before confirming.
                "type": "string",
                "enum": [template.id for template in TEMPLATES],
                "description": (
                    "The starter scaffold that best fits the idea. Omit it, or "
                    "use 'blank', when nothing fits."
                ),
            },
        },
        "required": ["name"],
        "additionalProperties": False,
    },
    run=propose_create_project,
    group="Project",
)
