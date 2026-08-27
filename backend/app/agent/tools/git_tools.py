from pathlib import Path

from app.agent.tools._process import run_subprocess
from app.agent.tools.base import Tool, ToolExecutionError
from app.core.workspace import resolve_safe_path


def _resolve_repo_path(path: str, workspace_root: Path) -> Path:
    target = resolve_safe_path(path or ".", workspace_root)
    if not target.exists():
        raise ToolExecutionError(f"No such directory: {path}")
    if not target.is_dir():
        raise ToolExecutionError(f"{path} is a file, not a directory.")
    return target


async def _git(
    args: list[str],
    *,
    cwd: Path,
    command_timeout_seconds: float,
    max_command_output_bytes: int,
) -> str:
    returncode, output = await run_subprocess(
        ["git", *args],
        cwd=cwd,
        timeout=command_timeout_seconds,
        max_output_bytes=max_command_output_bytes,
        shell=False,
    )
    body = output if output else "(no output)"
    return f"$ git {' '.join(args)}\n(exit code {returncode})\n{body}"


async def git_status(
    path: str = ".",
    *,
    workspace_root: Path,
    command_timeout_seconds: float,
    max_command_output_bytes: int,
    **_ignored: object,
) -> str:
    repo = _resolve_repo_path(path, workspace_root)
    return await _git(
        ["status", "--porcelain=v1", "-b"],
        cwd=repo,
        command_timeout_seconds=command_timeout_seconds,
        max_command_output_bytes=max_command_output_bytes,
    )


async def git_diff(
    path: str = ".",
    staged: bool = False,
    *,
    workspace_root: Path,
    command_timeout_seconds: float,
    max_command_output_bytes: int,
    **_ignored: object,
) -> str:
    repo = _resolve_repo_path(path, workspace_root)
    args = ["diff", "--staged"] if staged else ["diff"]
    return await _git(
        args,
        cwd=repo,
        command_timeout_seconds=command_timeout_seconds,
        max_command_output_bytes=max_command_output_bytes,
    )


async def git_log(
    path: str = ".",
    max_entries: int = 20,
    *,
    workspace_root: Path,
    command_timeout_seconds: float,
    max_command_output_bytes: int,
    **_ignored: object,
) -> str:
    repo = _resolve_repo_path(path, workspace_root)
    return await _git(
        ["log", f"-n{max_entries}", "--oneline"],
        cwd=repo,
        command_timeout_seconds=command_timeout_seconds,
        max_command_output_bytes=max_command_output_bytes,
    )


async def git_add(
    paths: list[str],
    path: str = ".",
    *,
    workspace_root: Path,
    command_timeout_seconds: float,
    max_command_output_bytes: int,
    **_ignored: object,
) -> str:
    repo = _resolve_repo_path(path, workspace_root)
    if not paths:
        raise ToolExecutionError("paths must contain at least one path to stage.")

    # Validate every path is inside the sandbox before it ever reaches git,
    # the same guardrail every other tool routes writes through.
    for candidate in paths:
        resolve_safe_path(candidate, workspace_root)

    return await _git(
        ["add", "--", *paths],
        cwd=repo,
        command_timeout_seconds=command_timeout_seconds,
        max_command_output_bytes=max_command_output_bytes,
    )


async def git_commit(
    message: str,
    path: str = ".",
    *,
    workspace_root: Path,
    command_timeout_seconds: float,
    max_command_output_bytes: int,
    **_ignored: object,
) -> str:
    repo = _resolve_repo_path(path, workspace_root)
    return await _git(
        ["commit", "-m", message],
        cwd=repo,
        command_timeout_seconds=command_timeout_seconds,
        max_command_output_bytes=max_command_output_bytes,
    )


async def git_branch(
    path: str = ".",
    create: str | None = None,
    *,
    workspace_root: Path,
    command_timeout_seconds: float,
    max_command_output_bytes: int,
    **_ignored: object,
) -> str:
    repo = _resolve_repo_path(path, workspace_root)
    args = ["branch", create] if create else ["branch", "--list"]
    return await _git(
        args,
        cwd=repo,
        command_timeout_seconds=command_timeout_seconds,
        max_command_output_bytes=max_command_output_bytes,
    )


async def git_show(
    ref: str,
    path: str = ".",
    *,
    workspace_root: Path,
    command_timeout_seconds: float,
    max_command_output_bytes: int,
    **_ignored: object,
) -> str:
    repo = _resolve_repo_path(path, workspace_root)
    return await _git(
        ["show", ref],
        cwd=repo,
        command_timeout_seconds=command_timeout_seconds,
        max_command_output_bytes=max_command_output_bytes,
    )


#: git tools are deliberately non-destructive to history and working state:
#: no checkout/switch/reset/push, so nothing here can discard uncommitted
#: work or rewrite what's already committed.
GIT_GROUP = "Version Control"

_REPO_PATH_PROPERTY = {
    "type": "string",
    "description": "Repository directory relative to the workspace root. Defaults to the workspace root.",
}

GIT_TOOLS: list[Tool] = [
    Tool(
        name="git_status",
        description="Show the working tree status (git status --porcelain -b).",
        input_schema={
            "type": "object",
            "properties": {"path": _REPO_PATH_PROPERTY},
            "required": [],
            "additionalProperties": False,
        },
        run=git_status,
        group=GIT_GROUP,
    ),
    Tool(
        name="git_diff",
        description="Show unstaged changes, or staged changes if staged is true.",
        input_schema={
            "type": "object",
            "properties": {
                "path": _REPO_PATH_PROPERTY,
                "staged": {
                    "type": "boolean",
                    "description": "Show staged (git diff --staged) instead of unstaged changes.",
                },
            },
            "required": [],
            "additionalProperties": False,
        },
        run=git_diff,
        group=GIT_GROUP,
    ),
    Tool(
        name="git_log",
        description="Show recent commit history, one line per commit.",
        input_schema={
            "type": "object",
            "properties": {
                "path": _REPO_PATH_PROPERTY,
                "max_entries": {
                    "type": "integer",
                    "description": "Maximum number of commits to show. Defaults to 20.",
                },
            },
            "required": [],
            "additionalProperties": False,
        },
        run=git_log,
        group=GIT_GROUP,
    ),
    Tool(
        name="git_add",
        description="Stage specific files or directories for commit.",
        input_schema={
            "type": "object",
            "properties": {
                "paths": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Paths to stage, relative to the workspace root.",
                },
                "path": _REPO_PATH_PROPERTY,
            },
            "required": ["paths"],
            "additionalProperties": False,
        },
        run=git_add,
        group=GIT_GROUP,
    ),
    Tool(
        name="git_commit",
        description=(
            "Commit whatever is currently staged. Call git_add first to "
            "choose what's included — this never stages files itself."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "message": {"type": "string", "description": "The commit message."},
                "path": _REPO_PATH_PROPERTY,
            },
            "required": ["message"],
            "additionalProperties": False,
        },
        run=git_commit,
        group=GIT_GROUP,
    ),
    Tool(
        name="git_branch",
        description=(
            "List local branches, or create a new one from create. Never "
            "switches branches."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "path": _REPO_PATH_PROPERTY,
                "create": {
                    "type": "string",
                    "description": "Name of a new branch to create, without switching to it.",
                },
            },
            "required": [],
            "additionalProperties": False,
        },
        run=git_branch,
        group=GIT_GROUP,
    ),
    Tool(
        name="git_show",
        description="Show a specific commit or ref (git show <ref>).",
        input_schema={
            "type": "object",
            "properties": {
                "ref": {
                    "type": "string",
                    "description": "Commit hash, branch, tag, or other git ref.",
                },
                "path": _REPO_PATH_PROPERTY,
            },
            "required": ["ref"],
            "additionalProperties": False,
        },
        run=git_show,
        group=GIT_GROUP,
    ),
]
