"""`file_stats`: size and shape, and which files read_file will refuse.

The flag at the bottom of a directory report is the point. read_file gives up
over max_file_bytes, and a model that meets that limit by calling read_file has
already spent the turn. Seeing "these files are too large, use read_symbol"
first turns a dead end into a route.
"""

from __future__ import annotations

from collections import defaultdict
from pathlib import Path

from app.agent.tools.base import Tool, ToolExecutionError
from app.agent.tools.search.search_tools import _SKIP_DIRS
from app.core.workspace import resolve_safe_path, to_display_path

INSIGHT_GROUP = "Project Insight"

#: Line-comment prefixes by extension. Block comments are not tracked: counting
#: them properly needs a lexer, and an approximate comment count is not worth
#: one. The label says "line comments" so the number is not oversold.
_COMMENT_PREFIXES = {
    ".py": ("#",),
    ".pyi": ("#",),
    ".sh": ("#",),
    ".yaml": ("#",),
    ".yml": ("#",),
    ".toml": ("#",),
    ".rb": ("#",),
    ".ts": ("//",),
    ".tsx": ("//",),
    ".js": ("//",),
    ".jsx": ("//",),
    ".mjs": ("//",),
    ".cjs": ("//",),
    ".go": ("//",),
    ".rs": ("//",),
    ".java": ("//",),
    ".c": ("//",),
    ".h": ("//",),
    ".cpp": ("//",),
    ".css": ("/*",),
    ".sql": ("--",),
}


def _human_bytes(count: int) -> str:
    if count < 1024:
        return f"{count} B"
    if count < 1024 * 1024:
        return f"{count / 1024:.0f} KB"
    return f"{count / (1024 * 1024):.1f} MB"


def _file_report(target: Path, display: str, max_file_bytes: int) -> str:
    size = target.stat().st_size
    try:
        text = target.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return f"{display}: {_human_bytes(size)}, not UTF-8 text (binary?)."

    lines = text.splitlines()
    blank = sum(1 for line in lines if not line.strip())
    prefixes = _COMMENT_PREFIXES.get(target.suffix.lower(), ())
    comments = (
        sum(1 for line in lines if line.strip().startswith(prefixes)) if prefixes else 0
    )
    longest = max((len(line) for line in lines), default=0)

    rows = [
        f"{display}",
        f"  size:          {_human_bytes(size)} ({size} bytes)",
        f"  lines:         {len(lines)} total, {len(lines) - blank} non-blank, {blank} blank",
    ]
    if prefixes:
        rows.append(f"  line comments: {comments}")
    rows.append(f"  longest line:  {longest} chars")

    if size > max_file_bytes:
        rows.append(
            f"  NOTE: over the {max_file_bytes}-byte read limit -- read_file will "
            "refuse this. Use read_symbol or code_outline instead."
        )
    return "\n".join(rows)


def _directory_report(root: Path, display: str, pattern: str, max_file_bytes: int) -> str:
    by_ext: dict[str, list[int]] = defaultdict(lambda: [0, 0, 0])  # files, lines, bytes
    largest: list[tuple[int, str]] = []
    oversized: list[tuple[int, str]] = []

    candidates = root.glob(pattern) if pattern else root.rglob("*")
    for path in candidates:
        if not path.is_file():
            continue
        if _SKIP_DIRS & set(path.relative_to(root).parts[:-1]):
            continue

        size = path.stat().st_size
        ext = path.suffix.lower() or "(no extension)"
        try:
            line_count = len(path.read_text(encoding="utf-8").splitlines())
        except (UnicodeDecodeError, OSError):
            # Binary or unreadable: count it toward files and bytes, not lines.
            entry = by_ext[ext]
            entry[0] += 1
            entry[2] += size
            continue

        entry = by_ext[ext]
        entry[0] += 1
        entry[1] += line_count
        entry[2] += size

        relative = path.relative_to(root).as_posix()
        largest.append((line_count, relative))
        if size > max_file_bytes:
            oversized.append((size, relative))

    if not by_ext:
        return f"{display}: no files matched."

    total_files = sum(entry[0] for entry in by_ext.values())
    total_lines = sum(entry[1] for entry in by_ext.values())
    rows = [f"{display} ({total_files} files, {total_lines:,} lines)"]

    for ext, (files, lines, size) in sorted(by_ext.items(), key=lambda kv: -kv[1][1]):
        rows.append(f"  {ext:<16} {files:>5} files  {lines:>8,} lines  {_human_bytes(size):>9}")

    largest.sort(reverse=True)
    if largest:
        rows.append("Largest by line count:")
        rows.extend(f"  {name:<50} {count:>7,} lines" for count, name in largest[:10])

    if oversized:
        oversized.sort(reverse=True)
        rows.append(
            f"{len(oversized)} file(s) exceed the {max_file_bytes}-byte read limit "
            "and must be read with read_symbol or code_outline:"
        )
        rows.extend(f"  {name}  ({_human_bytes(size)})" for size, name in oversized[:10])

    return "\n".join(rows)


def file_stats(
    path: str = ".",
    pattern: str = "",
    *,
    workspace_root: Path,
    max_file_bytes: int,
    **_ignored: object,
) -> str:
    target = resolve_safe_path(path or ".", workspace_root)
    if not target.exists():
        raise ToolExecutionError(f"No such path: {path}")

    display = to_display_path(target, workspace_root)
    if target.is_file():
        return _file_report(target, display, max_file_bytes)
    return _directory_report(target, display, pattern, max_file_bytes)


FILE_STATS_TOOL = Tool(
    name="file_stats",
    description=(
        "Size up a file or a directory before reading it. On a file: bytes, "
        "line counts and the longest line. On a directory: totals per "
        "extension, the largest files, and -- most usefully -- which files are "
        "too large for read_file to return, so you can reach for read_symbol "
        "instead of discovering the limit by hitting it."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "File or directory. Defaults to the workspace root.",
            },
            "pattern": {
                "type": "string",
                "description": (
                    "Optional glob to restrict a directory scan, e.g. '**/*.py'. "
                    "Ignored when path is a file."
                ),
            },
        },
        "required": [],
        "additionalProperties": False,
    },
    run=file_stats,
    group=INSIGHT_GROUP,
)
