"""`git_blame` and `git_stash`: history for one file, and shelving work safely.

These live beside git_tools rather than inside GIT_TOOLS because ALL_TOOLS is
append-only -- adding to that list would shift `remember` and the chat tools and
invalidate the cached prompt prefix for every session in flight. Same group, so
the composer still shows them under Version Control.

**Why git_stash has no drop or clear.** git_tools.py sets the rule in its own
comment: nothing in this package can discard uncommitted work or rewrite
committed history. `push` saves work and `pop` restores it, so both are safe;
`list` and `show` only read. `drop` and `clear` destroy a stash entry with no
undo, and an agent reaching for them is usually one bad inference away from
deleting something a human wanted. If that is genuinely the intent, a human can
run two words in a terminal.
"""

from __future__ import annotations

from pathlib import Path

from app.agent.tools.base import Tool, ToolExecutionError
from app.agent.tools.vcs.git_tools import (
    GIT_GROUP,
    _REPO_PATH_PROPERTY,
    _git,
    _resolve_repo_path,
)

#: Only the actions that cannot lose work. See the module docstring.
_STASH_ACTIONS = ("list", "push", "pop", "show")


async def git_blame(
    file: str,
    start_line: int | None = None,
    end_line: int | None = None,
    path: str = ".",
    *,
    workspace_root: Path,
    command_timeout_seconds: float,
    max_command_output_bytes: int,
    **_ignored: object,
) -> str:
    repo = _resolve_repo_path(path, workspace_root)

    # Check the file against the sandbox before it reaches git, the same way
    # git_add does -- git itself would happily blame a path outside it.
    target = (repo / file).resolve()
    root = workspace_root.resolve()
    if target != root and not target.is_relative_to(root):
        raise ToolExecutionError(f"{file} is outside the workspace.")

    args = ["blame", "-w"]

    if start_line is not None or end_line is not None:
        if start_line is None or end_line is None:
            raise ToolExecutionError(
                "Give both start_line and end_line, or neither."
            )
        if start_line < 1 or end_line < 1:
            raise ToolExecutionError("Line numbers start at 1.")
        if start_line > end_line:
            raise ToolExecutionError(
                f"start_line ({start_line}) is after end_line ({end_line})."
            )
        args.append(f"-L{start_line},{end_line}")

    args.extend(["--", file])
    return await _git(
        args,
        cwd=repo,
        command_timeout_seconds=command_timeout_seconds,
        max_command_output_bytes=max_command_output_bytes,
    )


async def git_stash(
    action: str = "list",
    message: str = "",
    path: str = ".",
    *,
    workspace_root: Path,
    command_timeout_seconds: float,
    max_command_output_bytes: int,
    **_ignored: object,
) -> str:
    if action not in _STASH_ACTIONS:
        raise ToolExecutionError(
            f"Unknown stash action {action!r}. Use one of: {', '.join(_STASH_ACTIONS)}. "
            "drop and clear are deliberately not available -- they destroy a "
            "stash entry with no undo. Ask the user to run those by hand."
        )

    repo = _resolve_repo_path(path, workspace_root)

    if action == "push":
        args = ["stash", "push"]
        if message.strip():
            args.extend(["-m", message.strip()])
    elif action == "show":
        args = ["stash", "show", "-p"]
    else:
        args = ["stash", action]

    return await _git(
        args,
        cwd=repo,
        command_timeout_seconds=command_timeout_seconds,
        max_command_output_bytes=max_command_output_bytes,
    )


GIT_INSPECT_TOOLS: list[Tool] = [
    Tool(
        name="git_blame",
        description=(
            "Show who last changed each line of a file, and in which commit. "
            "Use it to find out why a line is the way it is before changing it, "
            "or to find the commit that introduced a bug. Pass start_line and "
            "end_line together to blame just one range, which is much cheaper "
            "than blaming a whole large file."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "file": {
                    "type": "string",
                    "description": "File to blame, relative to the repository directory.",
                },
                "start_line": {
                    "type": "integer",
                    "description": "First line to blame. Requires end_line.",
                },
                "end_line": {
                    "type": "integer",
                    "description": "Last line to blame. Requires start_line.",
                },
                "path": _REPO_PATH_PROPERTY,
            },
            "required": ["file"],
            "additionalProperties": False,
        },
        run=git_blame,
        group=GIT_GROUP,
    ),
    Tool(
        name="git_stash",
        description=(
            "Shelve or restore uncommitted changes. 'list' shows the stash, "
            "'show' displays the most recent entry as a diff, 'push' shelves "
            "the current changes (optionally with a message), and 'pop' "
            "restores them. Dropping and clearing stashes are deliberately not "
            "offered: they discard work with no undo."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": list(_STASH_ACTIONS),
                    "description": "What to do. Defaults to 'list'.",
                },
                "message": {
                    "type": "string",
                    "description": "Label for the stash entry. Only used by 'push'.",
                },
                "path": _REPO_PATH_PROPERTY,
            },
            "required": [],
            "additionalProperties": False,
        },
        run=git_stash,
        group=GIT_GROUP,
    ),
]
