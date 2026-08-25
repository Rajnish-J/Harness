from pathlib import Path

from app.agent.tools.base import Tool, ToolExecutionError
from app.core.workspace import resolve_safe_path, to_display_path


def read_file(path: str, *, workspace_root: Path, max_file_bytes: int) -> str:
    target = resolve_safe_path(path, workspace_root)
    if not target.exists():
        raise ToolExecutionError(f"No such file: {path}")
    if target.is_dir():
        raise ToolExecutionError(f"{path} is a directory, not a file.")

    size = target.stat().st_size
    if size > max_file_bytes:
        raise ToolExecutionError(
            f"{path} is {size} bytes, over the {max_file_bytes}-byte read limit."
        )
    try:
        return target.read_text(encoding="utf-8")
    except UnicodeDecodeError as exc:
        raise ToolExecutionError(f"{path} is not valid UTF-8 text: {exc}") from exc


def write_file(
    path: str, content: str, *, workspace_root: Path, max_file_bytes: int
) -> str:
    encoded = content.encode("utf-8")
    if len(encoded) > max_file_bytes:
        raise ToolExecutionError(
            f"Content is {len(encoded)} bytes, over the "
            f"{max_file_bytes}-byte write limit."
        )

    target = resolve_safe_path(path, workspace_root)
    if target.is_dir():
        raise ToolExecutionError(f"{path} is an existing directory.")

    # Parent dirs are created inside the sandbox only — resolve_safe_path has
    # already proven `target` is contained, so its parents are too.
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    return f"Wrote {len(encoded)} bytes to {to_display_path(target, workspace_root)}"


def list_directory(
    path: str = ".", *, workspace_root: Path, max_file_bytes: int
) -> str:
    target = resolve_safe_path(path or ".", workspace_root)
    if not target.exists():
        raise ToolExecutionError(f"No such directory: {path}")
    if not target.is_dir():
        raise ToolExecutionError(f"{path} is a file, not a directory.")

    entries = sorted(target.iterdir(), key=lambda p: (p.is_file(), p.name))
    if not entries:
        return f"{to_display_path(target, workspace_root)} is empty."

    lines = [
        f"{entry.name}/" if entry.is_dir() else f"{entry.name}  ({entry.stat().st_size} bytes)"
        for entry in entries
    ]
    header = f"Contents of {to_display_path(target, workspace_root)}:"
    return "\n".join([header, *lines])


FILE_TOOLS: list[Tool] = [
    Tool(
        name="read_file",
        description=(
            "Read a UTF-8 text file from the workspace and return its contents. "
            "Paths are relative to the workspace root."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "File path relative to the workspace root.",
                }
            },
            "required": ["path"],
            "additionalProperties": False,
        },
        run=read_file,
    ),
    Tool(
        name="write_file",
        description=(
            "Write text to a file in the workspace, creating parent directories "
            "as needed and overwriting any existing file. Paths are relative to "
            "the workspace root."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "File path relative to the workspace root.",
                },
                "content": {
                    "type": "string",
                    "description": "Full text content to write.",
                },
            },
            "required": ["path", "content"],
            "additionalProperties": False,
        },
        run=write_file,
    ),
    Tool(
        name="list_directory",
        description=(
            "List the files and subdirectories at a path in the workspace. "
            "Defaults to the workspace root."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": (
                        "Directory path relative to the workspace root. "
                        "Use '.' for the root itself."
                    ),
                }
            },
            "required": [],
            "additionalProperties": False,
        },
        run=list_directory,
    ),
]
