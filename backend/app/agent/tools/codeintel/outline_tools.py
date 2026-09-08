"""`code_outline` and `read_symbol`: seeing a file's shape without reading it all.

Together these replace the usual "read_file a 900-line module to find one
function" move, which spends a large chunk of context to answer a small
question. Outline first, then read only the symbol that matters.
"""

from __future__ import annotations

import difflib
from pathlib import Path

from app.agent.tools.base import Tool, ToolExecutionError
from app.agent.tools.codeintel._python_ast import (
    PY_EXTS,
    Definition,
    iter_definitions,
    parse_python,
)
from app.agent.tools.codeintel._regex_scan import TS_EXTS, find_block_end, scan_definitions
from app.core.workspace import resolve_safe_path, to_display_path

CODEINTEL_GROUP = "Code Intelligence"

#: Appended whenever an answer came from the regex scanner, so the caveat
#: travels with the result rather than living only in the tool description.
REGEX_CAVEAT = "regex heuristic -- may miss dynamically defined or unconventional symbols"


def _read_source(path: str, workspace_root: Path, max_file_bytes: int) -> tuple[Path, str, str]:
    target = resolve_safe_path(path, workspace_root)
    display = to_display_path(target, workspace_root)

    if not target.exists():
        raise ToolExecutionError(f"No such file: {display}")
    if target.is_dir():
        raise ToolExecutionError(f"{display} is a directory, not a file.")
    if target.stat().st_size > max_file_bytes:
        raise ToolExecutionError(f"{display} is over the {max_file_bytes}-byte read limit.")
    try:
        return target, target.read_text(encoding="utf-8"), display
    except UnicodeDecodeError as exc:
        raise ToolExecutionError(f"{display} is not valid UTF-8 text: {exc}") from exc


def _unsupported(display: str, suffix: str) -> ToolExecutionError:
    supported = ", ".join(sorted(PY_EXTS | TS_EXTS))
    return ToolExecutionError(
        f"{display}: no outline support for {suffix or 'files without an extension'}. "
        f"Supported: {supported}. Use read_file or search_files instead."
    )


def code_outline(
    path: str, *, workspace_root: Path, max_file_bytes: int, **_ignored: object
) -> str:
    target, source, display = _read_source(path, workspace_root, max_file_bytes)
    suffix = target.suffix.lower()

    if suffix in PY_EXTS:
        definitions = list(iter_definitions(parse_python(source, display)))
        if not definitions:
            return f"Outline of {display} (python, ast): no classes or functions found."
        rows = [
            f"{d.lineno:>5}-{d.end_lineno:<5} {d.kind:<16} {d.qualified_signature}"
            for d in definitions
        ]
        return "\n".join([f"Outline of {display} (python, ast):", *rows])

    if suffix in TS_EXTS:
        found = scan_definitions(source)
        header = f"Outline of {display} (typescript/javascript, {REGEX_CAVEAT}):"
        if not found:
            return f"{header} no declarations matched."
        rows = [f"{d.lineno:>5}       {d.kind:<16} {d.text}" for d in found]
        return "\n".join([header, *rows])

    raise _unsupported(display, suffix)


def _numbered(lines: list[str], start: int) -> str:
    width = len(str(start + len(lines) - 1))
    return "\n".join(f"{start + offset:>{width}} | {line}" for offset, line in enumerate(lines))


def _truncate(rendered: str, max_file_bytes: int) -> str:
    if len(rendered.encode("utf-8")) <= max_file_bytes:
        return rendered
    return rendered[:max_file_bytes] + "\n... (symbol truncated)"


def _python_symbol(source: str, display: str, symbol: str, max_file_bytes: int) -> str:
    definitions = list(iter_definitions(parse_python(source, display)))
    wanted = symbol.strip()

    # Qualified match first, so read_symbol(path, "Tool.run") beats a bare
    # top-level `run` in the same file.
    matches = [d for d in definitions if d.qualname == wanted]
    if not matches:
        matches = [d for d in definitions if d.name == wanted]

    if not matches:
        names = sorted({d.qualname for d in definitions})
        close = difflib.get_close_matches(wanted, names, n=5, cutoff=0.5)
        hint = f" Closest names here: {', '.join(close)}." if close else ""
        raise ToolExecutionError(
            f"No symbol named {wanted!r} in {display}.{hint} "
            "Call code_outline on this file to see everything it defines."
        )

    if len(matches) > 1:
        where = ", ".join(f"{d.qualname} (line {d.lineno})" for d in matches)
        raise ToolExecutionError(
            f"{wanted!r} is ambiguous in {display}: {where}. "
            "Use the qualified 'Class.method' form."
        )

    found: Definition = matches[0]
    lines = source.splitlines()

    # Decorators are part of the definition: a @property or @router.get above a
    # function changes what it means, so cutting them off would mislead.
    start = found.decorator_lineno or found.lineno
    # Same for the contiguous comment block directly above, which is usually
    # the explanation of the thing being read.
    while start > 1 and lines[start - 2].strip().startswith("#"):
        start -= 1

    body = lines[start - 1 : found.end_lineno]
    header = f"{display}:{start}-{found.end_lineno}  ({found.kind} {found.qualname})"
    return f"{header}\n{_truncate(_numbered(body, start), max_file_bytes)}"


def _ts_symbol(source: str, display: str, symbol: str, max_file_bytes: int) -> str:
    found = [d for d in scan_definitions(source) if d.name == symbol.strip()]
    if not found:
        raise ToolExecutionError(
            f"No declaration of {symbol!r} matched in {display} ({REGEX_CAVEAT}). "
            "Call code_outline to see what did match."
        )
    if len(found) > 1:
        where = ", ".join(f"line {d.lineno}" for d in found)
        raise ToolExecutionError(
            f"{symbol!r} matched several declarations in {display}: {where}."
        )

    definition = found[0]
    lines = source.splitlines()
    end_index = find_block_end(lines, definition.lineno - 1)

    if end_index is None:
        # A declaration with no block at all (a type alias, an interface on one
        # line) or one this scanner mislocated. Show what we are sure of.
        return (
            f"{display}:{definition.lineno}  ({definition.kind} {definition.name})\n"
            f"{_numbered([lines[definition.lineno - 1]], definition.lineno)}\n"
            "(no closing brace found; showing the declaration line only)"
        )

    body = lines[definition.lineno - 1 : end_index + 1]
    header = (
        f"{display}:{definition.lineno}-{end_index + 1}  "
        f"({definition.kind} {definition.name}, {REGEX_CAVEAT})"
    )
    return f"{header}\n{_truncate(_numbered(body, definition.lineno), max_file_bytes)}"


def read_symbol(
    path: str,
    symbol: str,
    *,
    workspace_root: Path,
    max_file_bytes: int,
    **_ignored: object,
) -> str:
    target, source, display = _read_source(path, workspace_root, max_file_bytes)
    suffix = target.suffix.lower()

    if suffix in PY_EXTS:
        return _python_symbol(source, display, symbol, max_file_bytes)
    if suffix in TS_EXTS:
        return _ts_symbol(source, display, symbol, max_file_bytes)
    raise _unsupported(display, suffix)


OUTLINE_TOOLS: list[Tool] = [
    Tool(
        name="code_outline",
        description=(
            "List the classes, functions and methods in one file with their line "
            "numbers, without reading the whole file. Prefer this over read_file "
            "when you want a file's shape. Python is parsed with a real AST and "
            "the result is exact. TypeScript and JavaScript use line-based regex "
            "heuristics: they find conventionally written declarations and will "
            "miss symbols created dynamically, assigned inside closures, or "
            "spread across lines. Treat a TS/JS outline as a starting point, not "
            "an exhaustive list."
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
        run=code_outline,
        group=CODEINTEL_GROUP,
    ),
    Tool(
        name="read_symbol",
        description=(
            "Read one function, class or method from a file instead of the whole "
            "file. Output is line-numbered so you can cite file:line directly. "
            "For a method use the qualified 'Class.method' form. Python results "
            "include any decorators and the comment block directly above the "
            "definition, since both change what it means. If the name is not "
            "found you get the closest matches in that file, so a miss costs one "
            "call rather than a blind read."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "File path relative to the workspace root.",
                },
                "symbol": {
                    "type": "string",
                    "description": (
                        "Function, class, or method name. Use 'Class.method' for a "
                        "method, which is also how you disambiguate a repeated name."
                    ),
                },
            },
            "required": ["path", "symbol"],
            "additionalProperties": False,
        },
        run=read_symbol,
        group=CODEINTEL_GROUP,
    ),
]
