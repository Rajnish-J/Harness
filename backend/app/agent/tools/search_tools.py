import difflib
import re
from pathlib import Path

from app.agent.tools.base import Tool, ToolExecutionError
from app.core.workspace import resolve_safe_path, to_display_path

#: Noise directories skipped by both search_files and glob_files' walk.
_SKIP_DIRS = {".git", "node_modules", "__pycache__", ".next", ".venv", "venv"}


def _iter_text_files(root: Path, max_file_bytes: int):
    if root.is_file():
        yield root
        return

    for path in root.rglob("*"):
        if not path.is_file():
            continue
        if _SKIP_DIRS & set(path.relative_to(root).parts[:-1]):
            continue
        if path.stat().st_size > max_file_bytes:
            continue
        yield path


def search_files(
    pattern: str,
    path: str = ".",
    case_sensitive: bool = True,
    max_results: int = 200,
    *,
    workspace_root: Path,
    max_file_bytes: int,
    **_ignored: object,
) -> str:
    root = resolve_safe_path(path or ".", workspace_root)
    if not root.exists():
        raise ToolExecutionError(f"No such path: {path}")

    try:
        regex = re.compile(pattern, 0 if case_sensitive else re.IGNORECASE)
    except re.error as exc:
        raise ToolExecutionError(f"Invalid regular expression {pattern!r}: {exc}") from exc

    hits: list[str] = []
    for file_path in _iter_text_files(root, max_file_bytes):
        try:
            text = file_path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue

        display = to_display_path(file_path, workspace_root)
        for line_number, line in enumerate(text.splitlines(), start=1):
            if regex.search(line):
                hits.append(f"{display}:{line_number}: {line.strip()}")
                if len(hits) >= max_results:
                    break
        if len(hits) >= max_results:
            break

    if not hits:
        return f"No matches for {pattern!r} under {to_display_path(root, workspace_root)}."
    return "\n".join(hits)


def glob_files(
    pattern: str,
    path: str = ".",
    max_results: int = 200,
    *,
    workspace_root: Path,
    **_ignored: object,
) -> str:
    root = resolve_safe_path(path or ".", workspace_root)
    if not root.exists():
        raise ToolExecutionError(f"No such directory: {path}")
    if not root.is_dir():
        raise ToolExecutionError(f"{path} is a file, not a directory.")

    resolved_root = workspace_root.resolve()
    matches: list[str] = []
    for candidate in root.glob(pattern):
        resolved = candidate.resolve()
        if resolved != resolved_root and not resolved.is_relative_to(resolved_root):
            # A symlink followed outside the sandbox; skip rather than fail
            # the whole search over one bad entry.
            continue
        matches.append(to_display_path(resolved, workspace_root))

    matches.sort()
    if not matches:
        return f"No files match {pattern!r} under {to_display_path(root, workspace_root)}."
    truncated = matches[:max_results]
    if len(matches) > max_results:
        truncated.append(f"... ({len(matches) - max_results} more not shown)")
    return "\n".join(truncated)


def file_exists(path: str, *, workspace_root: Path, **_ignored: object) -> str:
    target = resolve_safe_path(path, workspace_root)
    display = to_display_path(target, workspace_root)
    if not target.exists():
        return f"{display} does not exist."
    if target.is_dir():
        return f"{display} exists (directory)."
    return f"{display} exists (file, {target.stat().st_size} bytes)."


def diff_files(
    path_a: str,
    path_b: str,
    *,
    workspace_root: Path,
    max_file_bytes: int,
    **_ignored: object,
) -> str:
    target_a = resolve_safe_path(path_a, workspace_root)
    target_b = resolve_safe_path(path_b, workspace_root)

    for label, target in (("path_a", target_a), ("path_b", target_b)):
        if not target.exists():
            raise ToolExecutionError(f"No such file ({label}): {target}")
        if target.is_dir():
            raise ToolExecutionError(f"{label} is a directory, not a file.")
        if target.stat().st_size > max_file_bytes:
            raise ToolExecutionError(f"{label} is over the {max_file_bytes}-byte read limit.")

    try:
        text_a = target_a.read_text(encoding="utf-8").splitlines(keepends=True)
        text_b = target_b.read_text(encoding="utf-8").splitlines(keepends=True)
    except UnicodeDecodeError as exc:
        raise ToolExecutionError(f"Not valid UTF-8 text: {exc}") from exc

    diff = list(
        difflib.unified_diff(
            text_a,
            text_b,
            fromfile=to_display_path(target_a, workspace_root),
            tofile=to_display_path(target_b, workspace_root),
        )
    )
    if not diff:
        return "Files are identical."
    return "".join(diff)


#: Search/verification tools: locating and comparing what's already in the
#: workspace, as distinct from File Operations' create/modify/delete tools.
SEARCH_GROUP = "Validation"

SEARCH_TOOLS: list[Tool] = [
    Tool(
        name="search_files",
        description=(
            "Search text files under a workspace path for a regular expression "
            "and return matching lines as path:line: text. Skips .git, "
            "node_modules, and similar noise directories."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "pattern": {
                    "type": "string",
                    "description": "Regular expression to search for.",
                },
                "path": {
                    "type": "string",
                    "description": "Directory or file to search under. Defaults to the workspace root.",
                },
                "case_sensitive": {
                    "type": "boolean",
                    "description": "Whether the match is case-sensitive. Defaults to true.",
                },
                "max_results": {
                    "type": "integer",
                    "description": "Maximum number of matching lines to return. Defaults to 200.",
                },
            },
            "required": ["pattern"],
            "additionalProperties": False,
        },
        run=search_files,
        group=SEARCH_GROUP,
    ),
    Tool(
        name="glob_files",
        description="Find files under a workspace path matching a glob pattern (e.g. '**/*.py').",
        input_schema={
            "type": "object",
            "properties": {
                "pattern": {
                    "type": "string",
                    "description": "Glob pattern, e.g. '**/*.py' or 'src/*.ts'.",
                },
                "path": {
                    "type": "string",
                    "description": "Base directory to glob under. Defaults to the workspace root.",
                },
                "max_results": {
                    "type": "integer",
                    "description": "Maximum number of paths to return. Defaults to 200.",
                },
            },
            "required": ["pattern"],
            "additionalProperties": False,
        },
        run=glob_files,
        group=SEARCH_GROUP,
    ),
    Tool(
        name="file_exists",
        description="Check whether a workspace path exists, and whether it's a file or a directory.",
        input_schema={
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Path relative to the workspace root.",
                }
            },
            "required": ["path"],
            "additionalProperties": False,
        },
        run=file_exists,
        group=SEARCH_GROUP,
    ),
    Tool(
        name="diff_files",
        description="Show a unified diff between two text files in the workspace.",
        input_schema={
            "type": "object",
            "properties": {
                "path_a": {
                    "type": "string",
                    "description": "First file, relative to the workspace root.",
                },
                "path_b": {
                    "type": "string",
                    "description": "Second file, relative to the workspace root.",
                },
            },
            "required": ["path_a", "path_b"],
            "additionalProperties": False,
        },
        run=diff_files,
        group=SEARCH_GROUP,
    ),
]
