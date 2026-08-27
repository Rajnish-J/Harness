import shutil
from pathlib import Path

from app.agent.tools.base import Tool, ToolExecutionError
from app.core.workspace import resolve_safe_path, to_display_path


def read_file(
    path: str, *, workspace_root: Path, max_file_bytes: int, **_ignored: object
) -> str:
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
    path: str,
    content: str,
    *,
    workspace_root: Path,
    max_file_bytes: int,
    **_ignored: object,
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
    path: str = ".",
    *,
    workspace_root: Path,
    max_file_bytes: int,
    **_ignored: object,
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


def edit_file(
    path: str,
    old_string: str,
    new_string: str,
    replace_all: bool = False,
    *,
    workspace_root: Path,
    max_file_bytes: int,
    **_ignored: object,
) -> str:
    target = resolve_safe_path(path, workspace_root)
    if not target.exists():
        raise ToolExecutionError(f"No such file: {path}")
    if target.is_dir():
        raise ToolExecutionError(f"{path} is a directory, not a file.")

    try:
        text = target.read_text(encoding="utf-8")
    except UnicodeDecodeError as exc:
        raise ToolExecutionError(f"{path} is not valid UTF-8 text: {exc}") from exc

    count = text.count(old_string)
    if count == 0:
        raise ToolExecutionError(f"old_string not found in {path}.")
    if count > 1 and not replace_all:
        raise ToolExecutionError(
            f"old_string appears {count} times in {path}; pass replace_all=true "
            "or include more surrounding context to make it unique."
        )

    updated = text.replace(old_string, new_string, -1 if replace_all else 1)
    encoded = updated.encode("utf-8")
    if len(encoded) > max_file_bytes:
        raise ToolExecutionError(
            f"Edit would make {path} {len(encoded)} bytes, over the "
            f"{max_file_bytes}-byte limit."
        )

    target.write_text(updated, encoding="utf-8")
    occurrences = count if replace_all else 1
    plural = "occurrence" if occurrences == 1 else "occurrences"
    return f"Replaced {occurrences} {plural} in {to_display_path(target, workspace_root)}"


def delete_file(path: str, *, workspace_root: Path, **_ignored: object) -> str:
    target = resolve_safe_path(path, workspace_root)
    if not target.exists():
        raise ToolExecutionError(f"No such file: {path}")
    if target.is_dir():
        raise ToolExecutionError(f"{path} is a directory; delete_file only removes files.")

    size = target.stat().st_size
    target.unlink()
    return f"Deleted {to_display_path(target, workspace_root)} ({size} bytes)"


def _resolve_move_or_copy(
    src: str, dest: str, overwrite: bool, workspace_root: Path
) -> tuple[Path, Path]:
    src_target = resolve_safe_path(src, workspace_root)
    dest_target = resolve_safe_path(dest, workspace_root)

    if not src_target.exists():
        raise ToolExecutionError(f"No such file: {src}")
    if src_target.is_dir():
        raise ToolExecutionError(f"{src} is a directory; only single files are supported.")
    if dest_target.exists() and not overwrite:
        raise ToolExecutionError(f"{dest} already exists; pass overwrite=true to replace it.")

    dest_target.parent.mkdir(parents=True, exist_ok=True)
    return src_target, dest_target


def move_file(
    src: str,
    dest: str,
    overwrite: bool = False,
    *,
    workspace_root: Path,
    **_ignored: object,
) -> str:
    src_target, dest_target = _resolve_move_or_copy(src, dest, overwrite, workspace_root)
    # Path.replace -> os.replace, which overwrites atomically on both POSIX and
    # Windows; Path.rename does not overwrite on Windows (WinError 183).
    src_target.replace(dest_target)
    return (
        f"Moved {to_display_path(src_target, workspace_root)} to "
        f"{to_display_path(dest_target, workspace_root)}"
    )


def copy_file(
    src: str,
    dest: str,
    overwrite: bool = False,
    *,
    workspace_root: Path,
    **_ignored: object,
) -> str:
    src_target, dest_target = _resolve_move_or_copy(src, dest, overwrite, workspace_root)
    shutil.copy2(src_target, dest_target)
    return (
        f"Copied {to_display_path(src_target, workspace_root)} to "
        f"{to_display_path(dest_target, workspace_root)}"
    )


def make_directory(path: str, *, workspace_root: Path, **_ignored: object) -> str:
    target = resolve_safe_path(path, workspace_root)
    if target.is_file():
        raise ToolExecutionError(f"{path} already exists and is a file.")

    already_existed = target.is_dir()
    target.mkdir(parents=True, exist_ok=True)
    display = to_display_path(target, workspace_root)
    return f"{display} already exists." if already_existed else f"Created {display}"


#: One group name for all File Operations tools, so the composer's tool panel
#: has a real section to render rather than an ungrouped pile.
FILE_GROUP = "File Operations"

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
        group=FILE_GROUP,
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
        group=FILE_GROUP,
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
        group=FILE_GROUP,
    ),
    Tool(
        name="edit_file",
        description=(
            "Replace an exact substring within a file. old_string must match "
            "exactly once unless replace_all is true; include enough "
            "surrounding context to make it unique. Paths are relative to the "
            "workspace root."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "File path relative to the workspace root.",
                },
                "old_string": {
                    "type": "string",
                    "description": "Exact text to find.",
                },
                "new_string": {
                    "type": "string",
                    "description": "Text to replace it with.",
                },
                "replace_all": {
                    "type": "boolean",
                    "description": "Replace every occurrence instead of requiring exactly one.",
                },
            },
            "required": ["path", "old_string", "new_string"],
            "additionalProperties": False,
        },
        run=edit_file,
        group=FILE_GROUP,
    ),
    Tool(
        name="delete_file",
        description="Delete a single file from the workspace. Refuses directories.",
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
        run=delete_file,
        group=FILE_GROUP,
    ),
    Tool(
        name="move_file",
        description=(
            "Move or rename a file within the workspace. Refuses to overwrite "
            "an existing destination unless overwrite is true."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "src": {
                    "type": "string",
                    "description": "Source file path relative to the workspace root.",
                },
                "dest": {
                    "type": "string",
                    "description": "Destination file path relative to the workspace root.",
                },
                "overwrite": {
                    "type": "boolean",
                    "description": "Overwrite dest if it already exists.",
                },
            },
            "required": ["src", "dest"],
            "additionalProperties": False,
        },
        run=move_file,
        group=FILE_GROUP,
    ),
    Tool(
        name="copy_file",
        description=(
            "Copy a file within the workspace. Refuses to overwrite an "
            "existing destination unless overwrite is true."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "src": {
                    "type": "string",
                    "description": "Source file path relative to the workspace root.",
                },
                "dest": {
                    "type": "string",
                    "description": "Destination file path relative to the workspace root.",
                },
                "overwrite": {
                    "type": "boolean",
                    "description": "Overwrite dest if it already exists.",
                },
            },
            "required": ["src", "dest"],
            "additionalProperties": False,
        },
        run=copy_file,
        group=FILE_GROUP,
    ),
    Tool(
        name="make_directory",
        description="Create a directory in the workspace, including any missing parents.",
        input_schema={
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Directory path relative to the workspace root.",
                }
            },
            "required": ["path"],
            "additionalProperties": False,
        },
        run=make_directory,
        group=FILE_GROUP,
    ),
]
