"""Letting a project's agent see the project's other conversations.

A project can hold several chats -- one per piece of work -- and each is a
separate session with its own history. Without these the model cannot tell that
any of them exist, only that some distilled memories arrived in its prompt.

Read-only and project-scoped: both refuse outside a project, because the global
chat has no siblings to list and `list_sessions(None)` would hand it every
unrelated conversation the operator has ever had.
"""

from __future__ import annotations

from app.agent.tools.base import Tool, ToolExecutionError
from app.db import project_chat_repo

LIST_PROJECT_CHATS_TOOL_NAME = "list_project_chats"
READ_PROJECT_CHAT_TOOL_NAME = "read_project_chat"

_NO_POOL = (
    "Conversation history is not available here. Do not retry; carry on "
    "without it."
)
_NO_PROJECT = (
    "No project is open, so there are no sibling conversations. Do not retry."
)


async def list_project_chats(limit: int = 20, **context: object) -> str:
    """Other conversations in this project, newest first."""
    pool = context.get("pool")
    project_id = context.get("project_id")
    current = context.get("session_id")

    if pool is None:
        raise ToolExecutionError(_NO_POOL)
    if not project_id:
        raise ToolExecutionError(_NO_PROJECT)

    capped = max(1, min(int(limit), 50))
    summaries = await project_chat_repo.list_sessions(pool, str(project_id), limit=capped)

    lines = [
        f"- {summary.session_id}: {summary.title} "
        f"({summary.message_count} messages, updated {summary.updated_at:%Y-%m-%d %H:%M})"
        for summary in summaries
        if summary.session_id != current
    ]
    if not lines:
        return "This is the only conversation in this project so far."

    return (
        f"{len(lines)} other conversation(s) in this project:\n"
        + "\n".join(lines)
        + "\n\nUse read_project_chat with a session id to see what one covered."
    )


async def read_project_chat(chat_id: str, limit: int = 60, **context: object) -> str:
    """The transcript of one sibling conversation.

    The argument is `chat_id`, not `session_id`: _dispatch_tool passes the
    CURRENT session as `session_id` in every tool's context, so a parameter of
    that name would collide and the tool could never be called.
    """
    pool = context.get("pool")
    project_id = context.get("project_id")

    if pool is None:
        raise ToolExecutionError(_NO_POOL)
    if not project_id:
        raise ToolExecutionError(_NO_PROJECT)
    if not chat_id.strip():
        raise ToolExecutionError("A session id is required.")

    # Confirm the id belongs to THIS project before reading it. Session ids are
    # guessable-ish strings and load_transcript_for_session does not scope by
    # project, so without this a model could read another project's chat.
    siblings = await project_chat_repo.list_sessions(pool, str(project_id), limit=200)
    if chat_id not in {summary.session_id for summary in siblings}:
        raise ToolExecutionError(
            f"No conversation {chat_id!r} in this project. Call "
            "list_project_chats first and use an id from it."
        )

    capped = max(1, min(int(limit), 200))
    rows = await project_chat_repo.load_transcript_for_session(
        pool, chat_id, limit=capped
    )
    if not rows:
        return "That conversation has no saved messages."

    lines: list[str] = []
    for row in rows:
        role = row.get("role", "?")
        if role == "tool_call":
            lines.append(f"[tool] {row.get('tool_name') or 'call'}")
            continue
        if role == "tool_result":
            continue
        content = (row.get("content") or "").strip()
        if content:
            lines.append(f"{role}: {content}")

    return "\n".join(lines) or "That conversation has no readable messages."


LIST_PROJECT_CHATS_TOOL = Tool(
    name=LIST_PROJECT_CHATS_TOOL_NAME,
    description=(
        "List the other conversations in the project that is currently open, "
        "newest first, with a title derived from how each one started. Use it "
        "when the user refers to work discussed elsewhere, or when the current "
        "chat lacks context that another one plainly had."
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
    run=list_project_chats,
    group="Project",
)

READ_PROJECT_CHAT_TOOL = Tool(
    name=READ_PROJECT_CHAT_TOOL_NAME,
    description=(
        "Read the transcript of another conversation in this project, using a "
        "session id from list_project_chats. Tool results are omitted and the "
        "message count is capped, so this is a summary of what was discussed "
        "rather than a full replay."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "chat_id": {
                "type": "string",
                "description": "A session id returned by list_project_chats.",
            },
            "limit": {
                "type": "integer",
                "description": "How many messages. Defaults to 60, capped at 200.",
            },
        },
        "required": ["chat_id"],
        "additionalProperties": False,
    },
    run=read_project_chat,
    group="Project",
)

CHAT_TOOLS: list[Tool] = [LIST_PROJECT_CHATS_TOOL, READ_PROJECT_CHAT_TOOL]
